import express from 'express';
import { 
  getDashboardEtudiant,
  getPaiementsEnAttente,
  getPaiementsValides,
  validerPaiement,
  rejeterPaiement,
  getStatistiquesPaiements,
  telechargerRecu,
  getEtudiantsPaiementsNonPayes,
  envoyerRappelsPaiements,
  getStatistiquesDetailleesParMois,
  getStatistiquesParMois,
  getRevenusParMoisCalendaire,
  getDetailsEtudiant,
  getFormationsDisponibles,
  getCohortesDisponibles,
  enregistrerPaiementAdmin,   // 🆕
  ajouterMoisSupplementaire   // 🆕
} from '../controllers/paiement.controller.js';
import { getDashboardParMoisCalendaire } from '../controllers/paiement.dashboard.controller.js'; // 🆕
import {
  getRetards,
  envoyerRelancesEmail,
  marquerRelanceWhatsApp
} from '../controllers/paiement.retard.controller.js';

const router = express.Router();

// ========================================
// 🎓 ROUTES ÉTUDIANT (lecture seule)
// ========================================
router.get('/etudiant/:email/dashboard', getDashboardEtudiant);
router.get('/etudiant/recu/:paiementId', telechargerRecu);
// ❌ Supprimé : router.post('/etudiant/:email/demander', demanderPaiement);
//    L'étudiant ne peut plus faire de demande de paiement.

// ========================================
// 🔐 ROUTES ADMIN
// ========================================

// 🆕 Valider un mois EN UNE ACTION (crée + valide + envoie le reçu)
// POST /api/paiements/admin/etudiant/123/valider-mois
// body : { "mois": 3 }   ou   { "mois": 3, "montant": 25000 }
router.post('/admin/etudiant/:inscriptionId/valider-mois', enregistrerPaiementAdmin);

// 🆕 « Ajouter un mois » (ex : 7 → 8 mois), puis valider le nouveau mois
// POST /api/paiements/admin/etudiant/123/ajouter-mois
router.post('/admin/etudiant/:inscriptionId/ajouter-mois', ajouterMoisSupplementaire);

// 🆕 Dashboard par MOIS CALENDAIRE (étudiants actifs uniquement, mois en cours par défaut)
// GET /api/paiements/admin/dashboard-mois?mois=2026-09&formation=Marketing&cohorte=1
router.get('/admin/dashboard-mois', getDashboardParMoisCalendaire);

// Anciennes demandes EN_ATTENTE (créées avant le changement) : à traiter puis la liste se vide
router.get('/admin/en-attente', getPaiementsEnAttente);
router.post('/admin/valider/:id', validerPaiement);
router.post('/admin/rejeter/:id', rejeterPaiement);

router.get('/admin/valides', getPaiementsValides);
router.get('/admin/stats', getStatistiquesPaiements);
router.get('/admin/stats-detaillees', getStatistiquesDetailleesParMois);
router.get('/admin/non-payes', getEtudiantsPaiementsNonPayes);
router.post('/admin/rappels', envoyerRappelsPaiements);

// Avec filtres ?formation=Web%20Development
// 📊 Vue par mois avec filtres (mois RELATIF, ex: "Mois 3" de chaque étudiant)
// GET /api/paiements/admin/stats-mois?formation=Marketing&cohorte=1
router.get('/admin/stats-mois', getStatistiquesParMois);

// 📊 Vue par MOIS CALENDAIRE réel (ex: "Février 2026"), toutes cohortes
// et dates de démarrage confondues. Répond à "combien j'ai reçu en Février 2026 ?"
// GET /api/paiements/admin/stats-mois-calendaire?formation=Marketing&cohorte=1
router.get('/admin/stats-mois-calendaire', getRevenusParMoisCalendaire);

// 👤 Détails d'un étudiant (écran de l'assistante : tous les mois + statut + peutValider)
// GET /api/paiements/admin/etudiant/123
router.get('/admin/etudiant/:id', getDetailsEtudiant);

// 📋 Listes de référence pour les filtres
// GET /api/paiements/admin/formations
router.get('/admin/formations', getFormationsDisponibles);

// GET /api/paiements/admin/cohortes?formation=Marketing
router.get('/admin/cohortes', getCohortesDisponibles);
// 🔔 Relances des étudiants en retard
router.get('/admin/retards', getRetards);
router.post('/admin/retards/email', envoyerRelancesEmail);
router.post('/admin/retards/:inscriptionId/whatsapp', marquerRelanceWhatsApp);

export default router;