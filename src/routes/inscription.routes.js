import express from 'express';
import {
  inscrireFormation,
  getInscriptionsPendantes,
  getInscriptionsValidees,
  validerInscription,
  modifierInscription,
  supprimerInscription,
  getStatistiques,
  marquerEtudiantInactif,
  reactiverEtudiant,
  inscrireGratuit,
} from '../controllers/inscription.controller.js';

const router = express.Router();

// ── PUBLIC ──────────────────────────────────────────────────
router.post('/inscrire', inscrireFormation);
router.post('/inscrire-gratuit', inscrireGratuit);

// ── ADMIN ───────────────────────────────────────────────────
router.get('/admin/pending',          getInscriptionsPendantes);
router.get('/admin/validated',        getInscriptionsValidees);
router.get('/admin/stats',            getStatistiques);
router.post('/admin/valider/:id',     validerInscription);

// ✅ NOUVEAU
router.put('/admin/:id',              modifierInscription);
router.delete('/admin/:id',           supprimerInscription);

router.patch('/:id/marquer-inactif',  marquerEtudiantInactif);
router.patch('/:id/reactiver',        reactiverEtudiant);

export default router;