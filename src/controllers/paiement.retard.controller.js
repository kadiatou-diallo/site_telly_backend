import prisma from '../config/database.js';
import { envoyerEmailRappelPaiement } from '../services/paiement-email.service.js';
import { formaterMoisCalendaire } from '../utils/moisCalendaire.js';
import {
  cleMoisCourant,
  cleDepuisDate,
  decalerMois,
  ecartMois
} from '../utils/calendrierPaiement.js';

// ========================================
// 🔔 RELANCES DES ÉTUDIANTS EN RETARD
//
// Un étudiant est "en retard" s'il est :
//   - actif (inscription VALIDATED + estActif), en paiement mensuel,
//     avec une date de démarrage ;
//   - et a au moins un mois ÉCHU sans paiement VALIDE.
//
// Mois échus :
//   - Mois 1 (mois suivant le démarrage) → mois précédent : toujours échus.
//   - Mois EN COURS : échu seulement à partir du jour 10 du mois
//     (variable d'environnement RELANCE_JOUR_LIMITE, 10 par défaut).
//     Avant le 10, on ne relance pas pour le mois en cours.
//   - Jamais au-delà de nombreMois.
// Un "Nouvel inscrit" (mois de démarrage) n'est jamais en retard.
//
// 🔁 On peut relancer autant de fois qu'on veut, tant que l'étudiant n'a pas
//    payé : aucune limite. Chaque relance est simplement journalisée
//    (table Relance) pour afficher la dernière date et le nombre de relances.
//
// Routes (voir paiement.routes.js) :
//   GET  /admin/retards                              → liste + liens WhatsApp
//   POST /admin/retards/email                        → email groupé (par lots)
//   POST /admin/retards/:inscriptionId/whatsapp      → enregistre un clic WhatsApp
// ========================================

const TEL_CONTACT = process.env.TELLYTECH_TEL || '78 111 87 69';
const JOUR_DEBUT_RELANCES = parseInt(process.env.RELANCE_JOUR_LIMITE) || 10;
const LIMITE_LOT = 20;              // max d'étudiants par requête d'envoi d'emails
const TAILLE_PAQUET_EMAIL = 5;      // emails envoyés en parallèle

// ========================================
// 🔧 HELPERS
// ========================================

// Le mois en cours est-il considéré "échu" aujourd'hui ? (à partir du jour 10)
const moisCourantEstEchu = () => new Date().getDate() >= JOUR_DEBUT_RELANCES;

// "30 000 FCFA" (espaces normaux, pour WhatsApp)
const formaterMontant = (montant) =>
  `${Number(montant || 0).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;

// Numéro → format international sans "+" pour wa.me (ex : "221781118769").
// Renvoie null si le numéro est absent ou inutilisable.
const normaliserTelephone = (telephone) => {
  if (!telephone) return null;

  const brut = String(telephone).trim();
  let chiffres = brut.replace(/\D/g, '');
  if (!chiffres) return null;

  const estInternational = brut.startsWith('+') || chiffres.startsWith('00');
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);

  // Numéro sénégalais local : 9 chiffres commençant par 7 (ex : 78 111 87 69)
  if (!estInternational && chiffres.length === 9 && chiffres.startsWith('7')) {
    return `221${chiffres}`;
  }

  // Sénégal déjà au format international : 221 + 9 chiffres
  if (chiffres.length === 12 && chiffres.startsWith('221')) return chiffres;

  // Autre pays, écrit avec + ou 00
  if (estInternational && chiffres.length >= 10 && chiffres.length <= 15) return chiffres;

  return null;
};

// Calcule les mois échus non payés d'une inscription (avec ses paiements VALIDE).
// Renvoie null si l'étudiant n'est pas en retard.
const calculerRetard = (ins, moisCourant, moisCourantEchu) => {
  if (!ins.mensualite || !ins.dateDemarrage) return null;

  const cleDemarrage = cleDepuisDate(ins.dateDemarrage);

  // Numéro du mois en cours dans la formation (0 ou moins = mois de démarrage)
  let dernierMoisEchu = ecartMois(moisCourant, cleDemarrage);

  // Avant le jour 10, le mois en cours n'est pas encore en retard
  if (!moisCourantEchu) dernierMoisEchu -= 1;

  dernierMoisEchu = Math.min(ins.nombreMois, dernierMoisEchu);
  if (dernierMoisEchu < 1) return null; // nouvel inscrit ou rien d'échu

  const moisPayes = new Set(
    ins.paiements.filter(p => p.status === 'VALIDE').map(p => p.mois)
  );

  const manquants = [];
  for (let m = 1; m <= dernierMoisEchu; m++) {
    if (!moisPayes.has(m)) manquants.push(m);
  }
  if (manquants.length === 0) return null;

  return {
    manquants,
    labels: manquants.map(m => formaterMoisCalendaire(decalerMois(cleDemarrage, m))),
    montantDu: manquants.length * ins.mensualite
  };
};

// Message WhatsApp pré-rempli
const construireMessageWhatsApp = ({ prenom, labels, montantDu }) =>
  `Bonjour ${prenom}, ici TellyTech.\n\n` +
  `Nous vous rappelons que votre paiement de formation pour ${labels.join(', ')} ` +
  `n'a pas encore été enregistré (montant : ${formaterMontant(montantDu)}).\n\n` +
  `Merci de régulariser dès que possible. Si vous avez déjà payé, ignorez ce message.\n\n` +
  `Contact : ${TEL_CONTACT}`;

// Journalise une relance. Ne lève JAMAIS d'erreur (le message est déjà parti).
const journaliser = async ({ inscriptionId, canal, moisManquants, statut, erreur }) => {
  try {
    await prisma.relance.create({
      data: {
        inscriptionId,
        canal,
        moisManquants: moisManquants.join(', '),
        statut,
        erreur: erreur ? String(erreur).slice(0, 500) : null
      }
    });
  } catch (e) {
    console.error('⚠️ Relance non journalisée:', e.message);
  }
};

// ========================================
// 📋 LISTE DES ÉTUDIANTS EN RETARD
//
// GET /admin/retards?formation=...&cohorte=...
// Chaque étudiant a son message et son lien wa.me prêts à l'emploi,
// plus la date de sa dernière relance et le nombre de relances déjà faites.
// ========================================
export const getRetards = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = { status: 'VALIDATED', estActif: true };
    if (formation) where.formation = formation;
    if (cohorte) where.cohorte = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where,
      include: { paiements: { where: { status: 'VALIDE' } } },
      orderBy: { nom: 'asc' }
    });

    const moisCourant = cleMoisCourant();
    const moisCourantEchu = moisCourantEstEchu();

    const enRetard = [];
    for (const ins of inscriptions) {
      const retard = calculerRetard(ins, moisCourant, moisCourantEchu);
      if (retard) enRetard.push({ ins, retard });
    }

    // Historique des relances réussies : dernière date + nombre, par canal
    const relances = enRetard.length > 0
      ? await prisma.relance.findMany({
          where: {
            inscriptionId: { in: enRetard.map(e => e.ins.id) },
            statut: 'ENVOYE'
          },
          orderBy: { createdAt: 'desc' },
          select: { inscriptionId: true, canal: true, createdAt: true }
        })
      : [];

    const historique = {};
    for (const r of relances) {
      if (!historique[r.inscriptionId]) {
        historique[r.inscriptionId] = {
          EMAIL: { derniere: null, nombre: 0 },
          WHATSAPP: { derniere: null, nombre: 0 }
        };
      }
      const canal = historique[r.inscriptionId][r.canal];
      if (!canal) continue;
      if (!canal.derniere) canal.derniere = r.createdAt; // triées de la plus récente à la plus ancienne
      canal.nombre++;
    }

    const etudiants = enRetard
      .map(({ ins, retard }) => {
        const telephoneWhatsApp = normaliserTelephone(ins.telephone);
        const message = construireMessageWhatsApp({
          prenom: ins.prenom,
          labels: retard.labels,
          montantDu: retard.montantDu
        });
        const h = historique[ins.id] || {
          EMAIL: { derniere: null, nombre: 0 },
          WHATSAPP: { derniere: null, nombre: 0 }
        };

        return {
          inscriptionId: ins.id,
          nom: `${ins.prenom} ${ins.nom}`,
          prenom: ins.prenom,
          email: ins.email,
          telephone: ins.telephone,
          telephoneWhatsApp,
          formation: ins.formation,
          cohorte: ins.cohorte,
          mensualite: ins.mensualite,
          moisManquants: retard.manquants,
          moisManquantsLabels: retard.labels,
          nombreMoisManquants: retard.manquants.length,
          montantDu: retard.montantDu,
          message,
          lienWhatsApp: telephoneWhatsApp
            ? `https://wa.me/${telephoneWhatsApp}?text=${encodeURIComponent(message)}`
            : null,
          derniereRelance: { email: h.EMAIL.derniere, whatsapp: h.WHATSAPP.derniere },
          nombreRelances: { email: h.EMAIL.nombre, whatsapp: h.WHATSAPP.nombre }
        };
      })
      // Les plus en retard d'abord, puis par nom
      .sort((a, b) =>
        b.nombreMoisManquants - a.nombreMoisManquants ||
        a.nom.localeCompare(b.nom, 'fr')
      );

    res.json({
      success: true,
      moisCourant: {
        cle: moisCourant,
        label: formaterMoisCalendaire(moisCourant),
        // Le mois en cours ne compte comme "retard" qu'à partir de ce jour
        jourDebutRelances: JOUR_DEBUT_RELANCES,
        estDejaEchu: moisCourantEchu
      },
      filtres: {
        formation: formation || null,
        cohorte: cohorte ? parseInt(cohorte) : null
      },
      resume: {
        total: etudiants.length,
        montantTotalDu: etudiants.reduce((s, e) => s + e.montantDu, 0),
        avecEmail: etudiants.filter(e => e.email).length,
        avecWhatsApp: etudiants.filter(e => e.lienWhatsApp).length,
        telephoneInvalide: etudiants.filter(e => !e.lienWhatsApp).length
      },
      limiteParLot: LIMITE_LOT,
      etudiants
    });

  } catch (error) {
    console.error('❌ Erreur liste des retards:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des étudiants en retard',
      error: error.message
    });
  }
};

// ========================================
// ✉️ EMAIL GROUPÉ AUX ÉTUDIANTS EN RETARD
//
// POST /admin/retards/email
// body : { inscriptionIds: [12, 15, ...] }
//
// - Max 20 étudiants par requête (le frontend envoie par lots : Vercel
//   limite la durée d'une requête).
// - Le retard est RECALCULÉ ici : un étudiant qui a payé entre-temps est ignoré.
// - Aucune limite de fréquence : on peut relancer autant de fois qu'on veut
//   tant que l'étudiant est en retard.
// ========================================
export const envoyerRelancesEmail = async (req, res) => {
  try {
    const brutIds = req.body.inscriptionIds;

    if (!Array.isArray(brutIds) || brutIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'inscriptionIds doit être une liste non vide'
      });
    }

    const ids = [...new Set(brutIds.map(Number).filter(Number.isInteger))];

    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Identifiants invalides' });
    }
    if (ids.length > LIMITE_LOT) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${LIMITE_LOT} étudiants par envoi. Envoyez par lots.`
      });
    }

    const inscriptions = await prisma.inscription.findMany({
      where: { id: { in: ids }, status: 'VALIDATED', estActif: true },
      include: { paiements: { where: { status: 'VALIDE' } } }
    });
    const parId = new Map(inscriptions.map(i => [i.id, i]));

    const moisCourant = cleMoisCourant();
    const moisCourantEchu = moisCourantEstEchu();
    const resultats = [];
    const aTraiter = [];

    for (const id of ids) {
      const ins = parId.get(id);

      if (!ins) {
        resultats.push({ inscriptionId: id, nom: null, statut: 'IGNORE', raison: 'INTROUVABLE_OU_INACTIF' });
        continue;
      }

      const nom = `${ins.prenom} ${ins.nom}`;
      const retard = calculerRetard(ins, moisCourant, moisCourantEchu);

      if (!retard) {
        resultats.push({ inscriptionId: id, nom, statut: 'IGNORE', raison: 'A_JOUR' });
      } else if (!ins.email) {
        resultats.push({ inscriptionId: id, nom, statut: 'IGNORE', raison: 'EMAIL_MANQUANT' });
      } else {
        aTraiter.push({ ins, nom, retard });
      }
    }

    // Envoi par petits paquets en parallèle
    for (let i = 0; i < aTraiter.length; i += TAILLE_PAQUET_EMAIL) {
      const paquet = aTraiter.slice(i, i + TAILLE_PAQUET_EMAIL);

      await Promise.all(paquet.map(async ({ ins, nom, retard }) => {
        try {
          await envoyerEmailRappelPaiement({
            nomComplet: nom,
            email: ins.email,
            formation: ins.formation,
            moisManquants: retard.labels,
            montantMensuel: ins.mensualite
          });

          await journaliser({
            inscriptionId: ins.id,
            canal: 'EMAIL',
            moisManquants: retard.labels,
            statut: 'ENVOYE'
          });
          resultats.push({ inscriptionId: ins.id, nom, statut: 'ENVOYE' });

        } catch (error) {
          console.error(`❌ Email de relance non envoyé à ${ins.email}:`, error);
          await journaliser({
            inscriptionId: ins.id,
            canal: 'EMAIL',
            moisManquants: retard.labels,
            statut: 'ECHEC',
            erreur: error.message
          });
          resultats.push({ inscriptionId: ins.id, nom, statut: 'ECHEC', erreur: error.message });
        }
      }));
    }

    const resume = {
      envoyes: resultats.filter(r => r.statut === 'ENVOYE').length,
      echecs: resultats.filter(r => r.statut === 'ECHEC').length,
      ignores: resultats.filter(r => r.statut === 'IGNORE').length
    };

    res.json({
      success: true,
      message: `${resume.envoyes} email(s) envoyé(s)` +
        (resume.echecs ? `, ${resume.echecs} échec(s)` : '') +
        (resume.ignores ? `, ${resume.ignores} ignoré(s)` : ''),
      resume,
      resultats
    });

  } catch (error) {
    console.error('❌ Erreur envoi des relances email:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi des relances',
      error: error.message
    });
  }
};

// ========================================
// 💬 ENREGISTRER UN CLIC « RELANCER SUR WHATSAPP »
//
// POST /admin/retards/:inscriptionId/whatsapp
//
// À appeler quand l'assistante clique sur le bouton WhatsApp, pour
// afficher ensuite "Relancé sur WhatsApp le 12 sept. (2 fois)" dans la liste.
// (On ne peut pas savoir si le message est réellement envoyé depuis
// WhatsApp : on enregistre que le lien a été ouvert.)
// ========================================
export const marquerRelanceWhatsApp = async (req, res) => {
  try {
    const inscriptionId = parseInt(req.params.inscriptionId);

    if (!Number.isInteger(inscriptionId)) {
      return res.status(400).json({ success: false, message: 'Identifiant invalide' });
    }

    const ins = await prisma.inscription.findFirst({
      where: { id: inscriptionId, status: 'VALIDATED', estActif: true },
      include: { paiements: { where: { status: 'VALIDE' } } }
    });

    if (!ins) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable' });
    }

    const retard = calculerRetard(ins, cleMoisCourant(), moisCourantEstEchu());
    if (!retard) {
      return res.status(400).json({ success: false, message: 'Cet étudiant n\'est pas en retard' });
    }

    const relance = await prisma.relance.create({
      data: {
        inscriptionId,
        canal: 'WHATSAPP',
        moisManquants: retard.labels.join(', '),
        statut: 'ENVOYE'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Relance WhatsApp enregistrée',
      relance: { id: relance.id, canal: relance.canal, createdAt: relance.createdAt }
    });

  } catch (error) {
    console.error('❌ Erreur enregistrement relance WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'enregistrement de la relance',
      error: error.message
    });
  }
};