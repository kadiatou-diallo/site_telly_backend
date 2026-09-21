// ========================================
// 🗓️ Utilitaires de calendrier de paiement
//
// RÈGLE : Mois 1 = mois SUIVANT le démarrage.
//   Démarrage en Juillet → Mois 1 = Août, Mois 2 = Septembre, ...
//
// Toutes les clés de mois sont au format "AAAA-MM" (ex : "2026-09").
// À placer dans : src/utils/calendrierPaiement.js
// ========================================

const pad = (n) => String(n).padStart(2, '0');

// "AAAA-MM" à partir d'une date
export const cleDepuisDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// Mois en cours (heure du serveur ; Dakar = UTC+0)
export const cleMoisCourant = () => cleDepuisDate(new Date());

// Décale une clé de n mois : ("2026-07", 1) → "2026-08"
export const decalerMois = (cle, n) => {
  const [annee, mois] = cle.split('-').map(Number);
  const total = annee * 12 + (mois - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
};

// Écart en mois entre deux clés : ("2026-09", "2026-07") → 2
export const ecartMois = (cle, base) => {
  const [a1, m1] = cle.split('-').map(Number);
  const [a2, m2] = base.split('-').map(Number);
  return (a1 - a2) * 12 + (m1 - m2);
};