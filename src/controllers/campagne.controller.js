import prisma from '../config/database.js';
import { construireWhere, envoyerLot, envoyerTest } from '../services/campagne.service.js';

const TYPES = ['ANNONCE', 'EVENEMENT', 'DEMANDE'];

const chargerDestinataires = (filtres) =>
  prisma.inscription.findMany({
    where: construireWhere(filtres),
    select: { id: true, email: true, prenom: true, nom: true, formation: true },
    orderBy: { createdAt: 'desc' },
  });

// POST /campagnes/apercu  { filtres }
export const apercu = async (req, res) => {
  try {
    const liste = await chargerDestinataires(req.body.filtres);
    res.json({
      success: true,
      count: liste.length,
      exemples: liste.slice(0, 10).map((d) => ({ email: d.email, nom: `${d.prenom} ${d.nom}`, formation: d.formation })),
    });
  } catch (e) {
    console.error('❌ apercu campagne:', e);
    res.status(500).json({ success: false, message: "Erreur lors de l'aperçu" });
  }
};

// POST /campagnes/test  { type, sujet, contenu, emailTest }
export const test = async (req, res) => {
  try {
    const { type = 'ANNONCE', sujet, contenu, emailTest } = req.body;
    if (!sujet || !contenu || !emailTest) {
      return res.status(400).json({ success: false, message: 'sujet, contenu et emailTest sont obligatoires' });
    }
    await envoyerTest({ type, sujet, contenu }, emailTest);
    res.json({ success: true, message: 'Email de test envoyé' });
  } catch (e) {
    console.error('❌ test campagne:', e);
    res.status(500).json({ success: false, message: "Échec de l'envoi du test" });
  }
};

// POST /campagnes  { type, sujet, contenu, filtres }  → crée la campagne (n'envoie rien)
export const creer = async (req, res) => {
  try {
    const { type = 'ANNONCE', sujet, contenu, filtres = {} } = req.body;
    if (!TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Type invalide : ANNONCE, EVENEMENT ou DEMANDE' });
    }
    if (!sujet?.trim() || !contenu?.trim()) {
      return res.status(400).json({ success: false, message: 'Le sujet et le message sont obligatoires' });
    }

    const liste = await chargerDestinataires(filtres);
    if (liste.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun destinataire pour ces filtres' });
    }

    const campagne = await prisma.campagne.create({
      data: {
        type, sujet: sujet.trim(), contenu: contenu.trim(), filtres,
        destinataires: {
          create: liste.map((d) => ({
            email: d.email,
            prenom: d.prenom,
            nomComplet: `${d.prenom} ${d.nom}`,
            formation: d.formation,
          })),
        },
      },
    });

    res.status(201).json({ success: true, campagneId: campagne.id, total: liste.length });
  } catch (e) {
    console.error('❌ creer campagne:', e);
    res.status(500).json({ success: false, message: 'Erreur lors de la création' });
  }
};

// POST /campagnes/:id/envoyer  → envoie le prochain lot
export const envoyer = async (req, res) => {
  try {
    const resultat = await envoyerLot(parseInt(req.params.id));
    res.json({ success: true, ...resultat });
  } catch (e) {
    console.error('❌ envoyer campagne:', e);
    res.status(500).json({ success: false, message: "Erreur lors de l'envoi" });
  }
};

// POST /campagnes/:id/relancer-echecs  → remet les ECHEC (et EN_COURS bloqués) en attente
export const relancerEchecs = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const r = await prisma.campagneDestinataire.updateMany({
      where: { campagneId: id, statut: { in: ['ECHEC', 'EN_COURS'] } },
      data: { statut: 'EN_ATTENTE', erreur: null },
    });
    await prisma.campagne.update({ where: { id }, data: { statut: 'EN_COURS' } });
    res.json({ success: true, remis: r.count });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
};

// GET /campagnes  → historique avec compteurs
export const lister = async (req, res) => {
  try {
    const campagnes = await prisma.campagne.findMany({ orderBy: { createdAt: 'desc' } });
    const stats = await prisma.campagneDestinataire.groupBy({
      by: ['campagneId', 'statut'],
      _count: { _all: true },
    });
    const resultat = campagnes.map((c) => {
      const s = stats.filter((x) => x.campagneId === c.id);
      const nb = (st) => s.find((x) => x.statut === st)?._count._all ?? 0;
      return {
        ...c,
        total: s.reduce((a, x) => a + x._count._all, 0),
        envoyes: nb('ENVOYE'), echecs: nb('ECHEC'), enAttente: nb('EN_ATTENTE'),
      };
    });
    res.json({ success: true, campagnes: resultat });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
  }
};

// GET /campagnes/:id  → détail + échecs
export const detail = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const campagne = await prisma.campagne.findUnique({
      where: { id },
      include: { destinataires: { where: { statut: 'ECHEC' }, select: { email: true, erreur: true } } },
    });
    if (!campagne) return res.status(404).json({ success: false, message: 'Campagne introuvable' });
    res.json({ success: true, campagne });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
};