import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';
import * as c from '../controllers/campagne.controller.js';

const router = Router();

// 1) d'abord authenticate (remplit req.user), 2) ensuite le contrôle du rôle
router.use(authenticate, requireAdmin);

router.get('/', c.lister);
router.post('/apercu', c.apercu);
router.post('/test', c.test);
router.post('/', c.creer);
router.get('/:id', c.detail);
router.post('/:id/envoyer', c.envoyer);
router.post('/:id/relancer-echecs', c.relancerEchecs);

export default router;