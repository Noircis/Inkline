/**
 * @module util
 * @description
 * Petites fonctions utilitaires sans dépendance, partagées par tous les modules.
 *
 * Aucune de ces fonctions ne touche au DOM : elles sont utilisables telles
 * quelles dans les tests Node.
 */

/** Tolérance utilisée pour comparer des durées exprimées en flottants (en noires). */
export const EPS = 1e-6;

/**
 * Génère un identifiant court, suffisamment unique pour un usage local
 * (notes et blocs d'un seul utilisateur).
 *
 * Format : 8 caractères aléatoires en base 36, suivis des 4 derniers caractères
 * de l'horodatage en base 36. Pas de garantie cryptographique : ce n'est pas le but.
 *
 * @returns {string} Identifiant, par ex. `"k3j9x0aa1b2c"`.
 */
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Modulo mathématique (toujours positif), contrairement à l'opérateur `%`
 * de JavaScript qui conserve le signe du dividende.
 *
 * @example
 * mod(-1, 7) // 6  (alors que -1 % 7 === -1)
 *
 * @param {number} a Dividende.
 * @param {number} n Diviseur (strictement positif).
 * @returns {number} Reste dans l'intervalle [0, n).
 */
export function mod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Borne une valeur dans un intervalle fermé.
 *
 * @param {number} v Valeur.
 * @param {number} lo Borne basse.
 * @param {number} hi Borne haute.
 * @returns {number} `v` ramenée dans [lo, hi].
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Arrondit une position temporelle pour neutraliser l'accumulation d'erreurs
 * flottantes. Sans ça, trois croches de triolet (3 × 1/3) donneraient parfois
 * 0.9999999999 au lieu de 1, et la mesure ne serait jamais considérée pleine.
 *
 * @param {number} x Position en noires.
 * @returns {number} Position arrondie à 1e-9 près.
 */
export function snap(x) {
  return Math.round(x * 1e9) / 1e9;
}

/**
 * Échappe une chaîne pour l'insérer dans du HTML ou du SVG généré par
 * template strings (protection contre l'injection de balises).
 *
 * @param {*} s Valeur à échapper (convertie en chaîne).
 * @returns {string} Chaîne sûre à placer entre balises ou dans un attribut entre guillemets.
 */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
