/**
 * @module chord-keys
 * @description
 * **Clavier d'accords** (2.8.5) : ce que fait chaque touche. Fonctions pures,
 * l'interface est dans {@link module:ui/chord-keyboard|ui/chord-keyboard}.
 *
 * On saisit un accord en deux temps : la **fondamentale** (`C` … `B`, puis
 * ♭ ou ♯), puis la **couleur** d'un seul toucher (`7`, `−7`, `Δ7`, `ø7`…).
 * Le pavé détaillé (`⋯`) ajoute les morceaux un par un pour les accords
 * rares (`C7♯9♭13`).
 *
 * Les accords sont **enregistrés en texte** dans la notation d'iReal Pro
 * (`-7`, `^7`, `h7`, `o7`), que le reste de l'appli lit déjà
 * ({@link module:chords|chords}, {@link module:ireal|ireal}) ; l'affichage
 * les met en forme (`C−7`, `CΔ7`, `Cø7`, `C°7`).
 *
 * Une mesure de grille est une liste de cases (`ch`) ; on écrit toujours dans
 * la **dernière** case. `␣` en ouvre une nouvelle (deux accords dans la
 * mesure), `⌫` efface le dernier morceau tapé.
 */

/**
 * Une touche.
 * @typedef {Object} ChordKey
 * @property {'root'|'acc'|'qual'|'add'|'slash'|'nc'|'sim'|'space'|'back'} t Type :
 *   fondamentale (ou basse après `/`), altération de la dernière lettre,
 *   couleur complète (remplace), morceau de couleur (ajoute), basse,
 *   *no chord*, mesure répétée, case suivante, effacement.
 * @property {string} [v] Valeur : lettre, `b`/`#`, qualité en notation iReal.
 */

/** Cases au plus dans une mesure. */
export const MAX_SLOTS = 4;

/**
 * Découpe un accord en cours de saisie. La basse peut être en attente
 * (`C/`, après la touche `/`).
 * @param {string} c
 * @returns {?{root: string, q: string, slash: boolean, bass: string}}
 */
export function splitChord(c) {
  const m = /^([A-G][b#]?)([^/]*)(\/([A-G][b#]?)?)?$/.exec(c);
  if (!m) return null;
  return { root: m[1], q: m[2], slash: !!m[3], bass: m[4] || '' };
}

/** Recompose un accord. */
const join = (p) => p.root + p.q + (p.slash ? '/' + p.bass : '');

/**
 * Ajoute, change ou retire l'altération d'un nom de note (même touche deux
 * fois : retirée).
 * @param {string} name `C`, `Bb`…
 * @param {string} acc `b` ou `#`.
 * @returns {string}
 */
function toggleAcc(name, acc) {
  const cur = name.slice(1);
  return name[0] + (cur === acc ? '' : acc);
}

/**
 * Applique une touche à une mesure (ou à l'accord d'une note : une seule
 * case).
 *
 * @example
 * applyChordKey([], { t: 'root', v: 'B' })          // ['B']
 * applyChordKey(['B'], { t: 'acc', v: 'b' })        // ['Bb']
 * applyChordKey(['Bb'], { t: 'qual', v: '-7' })     // ['Bb-7']
 * applyChordKey(['Bb-7'], { t: 'space' })           // ['Bb-7', '']
 * applyChordKey(['Bb-7', ''], { t: 'root', v: 'E' }) // ['Bb-7', 'E']
 *
 * @param {Array.<string>} slots Cases de la mesure (non modifiées).
 * @param {ChordKey} key
 * @returns {Array.<string>} Nouvelles cases (`[]` : mesure vide).
 */
export function applyChordKey(slots, key) {
  if (key.t === 'sim') return ['%'];
  const s = slots.length ? slots.slice() : [''];
  if (s.length === 1 && s[0] === '%') s[0] = ''; // on écrit par-dessus la répétition
  const i = s.length - 1;
  let c = s[i];
  if (c === 'n' && key.t !== 'back' && key.t !== 'space') c = '';
  const p = splitChord(c);

  switch (key.t) {
    case 'root':
      if (p && p.slash && !p.bass) c = join({ ...p, bass: key.v });
      else c = key.v; // nouvel accord dans la case
      break;
    case 'acc':
      if (!p) break;
      if (p.slash && p.bass) c = join({ ...p, bass: toggleAcc(p.bass, key.v) });
      else c = join({ ...p, root: toggleAcc(p.root, key.v) });
      break;
    case 'qual': // couleur complète ; la même touche deux fois l'enlève
      if (!p) break;
      c = join({ ...p, q: p.q === key.v ? '' : key.v });
      break;
    case 'add':
      if (!p || p.slash) break;
      c = join({ ...p, q: p.q + key.v });
      break;
    case 'slash':
      if (p && !p.slash) c = join({ ...p, slash: true });
      break;
    case 'nc':
      c = 'n';
      break;
    case 'space':
      if (c !== '' && s.length < MAX_SLOTS) {
        s[i] = c;
        s.push('');
        return s;
      }
      break;
    case 'back':
      if (c === '') {
        if (s.length > 1) s.pop();
        else return [];
        return s.length === 1 && s[0] === '' ? [] : s;
      }
      c = backChord(c);
      break;
    default:
      break;
  }
  s[i] = c;
  return s.length === 1 && s[0] === '' ? [] : s;
}

/**
 * Efface le dernier morceau d'un accord : altération de la basse, basse,
 * barre, dernier morceau de couleur (`alt`, `sus`, `11`, `♭9`, `7`…),
 * altération de la fondamentale, fondamentale.
 * @param {string} c
 * @returns {string}
 */
function backChord(c) {
  const p = splitChord(c);
  if (!p) return '';
  if (p.slash) {
    if (p.bass.length > 1) return join({ ...p, bass: p.bass[0] });
    if (p.bass) return join({ ...p, bass: '' });
    return join({ ...p, slash: false });
  }
  if (p.q) return join({ ...p, q: p.q.replace(/(sus|add|alt|[b#]?1[13]|[b#]?\d|.)$/, '') });
  if (p.root.length > 1) return p.root[0];
  return '';
}
