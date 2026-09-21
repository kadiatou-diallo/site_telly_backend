import prisma from '../config/database.js';
import { formaterMoisCalendaire } from '../utils/moisCalendaire.js';

// ========================================
// 📅 DASHBOARD ADMIN PAR MOIS CALENDAIRE
//
// GET /admin/dashboard-mois?mois=2026-09&formation=...&cohorte=...
//
// RÈGLE (basée UNIQUEMENT sur dateDemarrage) :
//   - Mois de démarrage (ex : Juillet)  → étudiant "NOUVEAU" : ni payé, ni non payé
//   - Mois 1 = mois SUIVANT le démarrage (ex : Août)
//   - Mois N = démarrage + N mois
//   - Après le dernier mois (nombreMois) → l'étudiant ne paie plus
//   - Un mois est "payé" si un paiement VALIDE existe pour son numéro (1..N)
//
// Autres règles :
// - Ne concerne QUE les étudiants actifs (inscription VALIDATED + estActif)
// - `mois` au format "AAAA-MM". Absent → mois en cours.
// - Paiement unique (mensualite vide) : pas de mensualité, non compté ici.
// - Sans dateDemarrage (anciennes données) : compté à part
//   (etudiantsSansDateDemarrage).
// ========================================

const REGEX_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n) => String(n).padStart(2, '0');

// "AAAA-MM" à partir d'une date
const cleDepuisDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// Mois en cours au format "AAAA-MM" (heure du serveur ; Dakar = UTC+0)
const cleMoisCourant = () => cleDepuisDate(new Date());

// Décale une clé de n mois : ("2026-07", 1) → "2026-08"
const decalerMois = (cle, n) => {
  const [annee, mois] = cle.split('-').map(Number);
  const total = annee * 12 + (mois - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
};

// Écart en mois : ("2026-09", "2026-07") → 2
const ecartMois = (cle, base) => {
  const [a1, m1] = cle.split('-').map(Number);
  const [a2, m2] = base.split('-').map(Number);
  return (a1 - a2) * 12 + (m1 - m2);
};

const ORDRE_STATUT = { NON_PAYE: 0, EN_ATTENTE: 1, VALIDE: 2, NOUVEAU: 3 };

const nouvellesStats = () => ({
  etudiantsActifs: 0,
  nouveaux: 0,         // inscrits ce mois-là (ou plus tard) : pas encore à payer
  doiventPayer: 0,
  ontPaye: 0,
  enAttente: 0,
  nonPaye: 0,          // = doiventPayer - ontPaye (inclut les anciennes demandes en attente)
  tauxPaiement: 0,     // pourcentage 0-100
  revenus: 0,          // somme des paiements VALIDES du mois
  montantAttendu: 0    // somme des mensualités dues ce mois
});

const finaliserStats = (stats) => {
  stats.nonPaye = stats.doiventPayer - stats.ontPaye;
  stats.tauxPaiement = stats.doiventPayer > 0
    ? Math.round((stats.ontPaye / stats.doiventPayer) * 1000) / 10
    : 0;
  return stats;
};

export const getDashboardParMoisCalendaire = async (req, res) => {
  try {
    const moisCle = req.query.mois || cleMoisCourant();

    if (!REGEX_MOIS.test(moisCle)) {
      return res.status(400).json({
        success: false,
        message: 'Format de mois invalide. Attendu : AAAA-MM (ex : 2026-09)'
      });
    }

    const { formation } = req.query;
    const cohorteNum = req.query.cohorte ? parseInt(req.query.cohorte) : null;

    // ── Étudiants actifs uniquement ───────────────────────────────────────
    const baseWhere = { status: 'VALIDATED', estActif: true };

    // Listes pour les filtres (calculées sur tous les actifs, pas sur la sélection)
    const actifsPourFiltres = await prisma.inscription.findMany({
      where: baseWhere,
      select: { formation: true, cohorte: true }
    });

    const formationsDisponibles = [...new Set(actifsPourFiltres.map(i => i.formation))]
      .sort((a, b) => a.localeCompare(b, 'fr'));

    const cohortesDisponibles = [...new Set(
      actifsPourFiltres
        .filter(i => i.cohorte !== null && (!formation || i.formation === formation))
        .map(i => i.cohorte)
    )].sort((a, b) => a - b);

    // ── Sélection courante ────────────────────────────────────────────────
    const where = { ...baseWhere };
    if (formation) where.formation = formation;
    if (Number.isInteger(cohorteNum)) where.cohorte = cohorteNum;

    const inscriptions = await prisma.inscription.findMany({
      where,
      include: { paiements: true },
      orderBy: { nom: 'asc' }
    });

    const demandesEnAttente = await prisma.paiement.count({
      where: { status: 'EN_ATTENTE', inscription: where }
    });

    // ── Calcul ────────────────────────────────────────────────────────────
    const global = nouvellesStats();
    global.etudiantsActifs = inscriptions.length;

    const parFormationMap = {};
    const etudiants = [];
    const moisDisponiblesSet = new Set([cleMoisCourant(), moisCle]);
    let etudiantsSansDateDemarrage = 0;

    for (const ins of inscriptions) {
      if (!parFormationMap[ins.formation]) {
        parFormationMap[ins.formation] = { formation: ins.formation, ...nouvellesStats() };
      }
      const statsFormation = parFormationMap[ins.formation];
      statsFormation.etudiantsActifs++;

      // Paiement unique : pas de mensualités
      if (!ins.mensualite) continue;

      // Ancienne donnée : impossible de placer les mois dans le calendrier
      if (!ins.dateDemarrage) {
        etudiantsSansDateDemarrage++;
        continue;
      }

      // ── Calendrier de l'étudiant, calculé depuis dateDemarrage ──────────
      // Démarrage en Juillet → Mois 1 = Août, Mois 2 = Septembre, ...
      const cleDemarrage = cleDepuisDate(ins.dateDemarrage);
      moisDisponiblesSet.add(cleDemarrage);
      for (let m = 1; m <= ins.nombreMois; m++) {
        moisDisponiblesSet.add(decalerMois(cleDemarrage, m));
      }

      // Quel mois de la formation est le mois demandé ?
      //   ≤ 0 : mois du démarrage (ou avant) → NOUVEAU
      //   1..N : mois de paiement
      //   > N : formation terminée → ne paie plus
      const moisRelatif = ecartMois(moisCle, cleDemarrage);

      if (moisRelatif <= 0) {
        global.nouveaux++;
        statsFormation.nouveaux++;

        etudiants.push({
          inscriptionId: ins.id,
          nom: `${ins.prenom} ${ins.nom}`,
          email: ins.email,
          telephone: ins.telephone,
          formation: ins.formation,
          cohorte: ins.cohorte,
          mois: null,
          nombreMois: ins.nombreMois,
          statut: 'NOUVEAU',
          montant: ins.mensualite,
          paiementId: null,
          dateValidation: null,
          dateInscription: ins.dateDemarrage
        });
        continue;
      }

      if (moisRelatif > ins.nombreMois) continue; // formation terminée : ne paie plus ce mois-ci

      const paiementsDuMois = ins.paiements.filter(p => p.mois === moisRelatif);
      const valide = paiementsDuMois.find(p => p.status === 'VALIDE');
      const enAttente = paiementsDuMois.find(p => p.status === 'EN_ATTENTE');

      const statut = valide ? 'VALIDE' : enAttente ? 'EN_ATTENTE' : 'NON_PAYE';
      const montant = valide ? valide.montant : ins.mensualite;

      for (const stats of [global, statsFormation]) {
        stats.doiventPayer++;
        stats.montantAttendu += ins.mensualite;
        if (statut === 'VALIDE') {
          stats.ontPaye++;
          stats.revenus += valide.montant;
        } else if (statut === 'EN_ATTENTE') {
          stats.enAttente++;
        }
      }

      etudiants.push({
        inscriptionId: ins.id,
        nom: `${ins.prenom} ${ins.nom}`,
        email: ins.email,
        telephone: ins.telephone,
        formation: ins.formation,
        cohorte: ins.cohorte,
        mois: moisRelatif,
        nombreMois: ins.nombreMois,
        statut,
        montant,
        paiementId: (valide || enAttente)?.id || null,
        dateValidation: valide?.dateValidation || null,
        dateInscription: ins.dateDemarrage
      });
    }

    // Non payés d'abord (c'est ce que l'assistante doit traiter), puis par nom.
    // Les nouveaux inscrits (rien à traiter) sont en bas de liste.
    etudiants.sort((a, b) =>
      ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] ||
      a.nom.localeCompare(b.nom, 'fr')
    );

    const parFormation = Object.values(parFormationMap)
      .map(finaliserStats)
      .sort((a, b) => a.formation.localeCompare(b.formation, 'fr'));

    const moisDisponibles = [...moisDisponiblesSet]
      .sort()
      .map(cle => ({ cle, label: formaterMoisCalendaire(cle) }));

    res.json({
      success: true,
      mois: {
        cle: moisCle,
        label: formaterMoisCalendaire(moisCle),
        estMoisCourant: moisCle === cleMoisCourant()
      },
      filtres: {
        formation: formation || null,
        cohorte: Number.isInteger(cohorteNum) ? cohorteNum : null
      },
      global: finaliserStats(global),
      parFormation,
      etudiants,
      etudiantsSansDateDemarrage,
      demandesEnAttente,
      formationsDisponibles,
      cohortesDisponibles,
      moisDisponibles
    });

  } catch (error) {
    console.error('❌ Erreur dashboard par mois calendaire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du dashboard',
      error: error.message
    });
  }
};