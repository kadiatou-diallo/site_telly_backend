import prisma from '../config/database.js';
import { envoyerEmailAdmin, envoyerEmailValidation, envoyerEmailInscription } from '../services/email.service.js';
import bcrypt from 'bcryptjs';
import { calculerDateFinFormation } from '../utils/moisCalendaire.js';

function genererCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// ========================================
// 🏷️  MODES D'INSCRIPTION
//
//  EN_LIGNE / PRESENTIEL → paiement (mensuel ou unique), reçu, cohorte
//  PONCTUEL              → petits montants libres, reçu, PAS de cohorte
//  GRATUIT               → aucun paiement, aucun reçu, PAS de cohorte
//                          (université, promotion si UNCHK, filière requises)
// ========================================
const MODES = ['EN_LIGNE', 'PRESENTIEL', 'PONCTUEL', 'GRATUIT'];

const estModePayant = (mode) => mode === 'EN_LIGNE' || mode === 'PRESENTIEL';

const estUNCHK = (universite) =>
  typeof universite === 'string' && universite.trim().toUpperCase() === 'UNCHK';

// Type de paiement exposé au frontend (compatible avec l'ancien champ typePaiement)
const typePaiementDe = (ins) => {
  if (ins.mode === 'GRATUIT')  return 'GRATUIT';
  if (ins.mode === 'PONCTUEL') return 'PONCTUEL';
  return !ins.mensualite || ins.mensualite === 0 ? 'UNIQUE' : 'MENSUEL';
};

// Vérifie les informations demandées aux étudiants gratuits
const verifierInfosGratuit = ({ universite, promotion, filiere }) => {
  if (!universite || !String(universite).trim() || !filiere || !String(filiere).trim()) {
    return "Pour une inscription gratuite, l'université et la filière sont obligatoires";
  }
  if (estUNCHK(universite) && (!promotion || !String(promotion).trim())) {
    return "Pour l'UNCHK, la promotion est obligatoire";
  }
  return null;
};

const normaliserInfosGratuit = ({ universite, promotion, filiere }) => ({
  universite: String(universite).trim(),
  promotion:  estUNCHK(universite) ? String(promotion).trim() : null,
  filiere:    String(filiere).trim()
});

// Le code sert aussi de mot de passe : on s'assure qu'il n'existe pas déjà
async function genererCodeUnique() {
  for (let i = 0; i < 10; i++) {
    const code = genererCode();
    const existe = await prisma.inscription.findUnique({ where: { code } });
    if (!existe) return code;
  }
  throw new Error('Impossible de générer un code unique');
}

// ========================================
// 📌 PARTIE PUBLIQUE (CLIENT)
// ========================================

// Formations payantes : l'inscription reste PENDING jusqu'à la validation admin
export const inscrireFormation = async (req, res) => {
  try {
    const { nom, prenom, email, telephone, formationId } = req.body;

    if (!nom || !prenom || !email || !telephone || !formationId) {
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    }

    const formation = await prisma.formation.findUnique({
      where: { id: parseInt(formationId) }
    });

    if (!formation) {
      return res.status(404).json({ success: false, message: 'Formation introuvable' });
    }

    if (!formation.estActif) {
      return res.status(400).json({ success: false, message: "Cette formation n'est plus disponible" });
    }

    const existant = await prisma.inscription.findFirst({ where: { email } });
    if (existant) {
      return res.status(400).json({ message: 'Cet email est déjà inscrit' });
    }

    const code = genererCode();

    const inscription = await prisma.inscription.create({
      data: {
        nom,
        prenom,
        email,
        telephone,
        formation: formation.titre,
        code,
        status:   'PENDING',
        estActif: true,
      }
    });

    await envoyerEmailAdmin({
      nomComplet:    `${prenom} ${nom}`,
      email,
      telephone,
      formation:     formation.titre,
      code,
      inscriptionId: inscription.id
    });

    try {
      await envoyerEmailInscription({
        nomComplet:    `${prenom} ${nom}`,
        email,
        formation:     formation.titre,
        code,
        inscriptionId: inscription.id
      });
      console.log("✅ Email de confirmation envoyé à l'étudiant");
    } catch (emailError) {
      console.error('❌ Erreur email étudiant (non bloquant):', emailError.message);
    }

    res.status(201).json({
      success:       true,
      message:       'Inscription enregistrée avec succès ! Vous recevrez un email de confirmation après validation.',
      inscriptionId: inscription.id
    });

  } catch (error) {
    console.error('❌ Erreur inscription:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'inscription" });
  }
};

// ========================================
// 🆓 INSCRIPTION GRATUITE — SANS VALIDATION ADMIN
//
//   → inscription créée directement en VALIDATED, mode GRATUIT
//   → compte User créé tout de suite (mot de passe = code)
//   → email de bienvenue avec le code envoyé immédiatement
//
//   Les 3 autres modes (EN_LIGNE, PRESENTIEL, PONCTUEL) passent par
//   inscrireFormation puis validerInscription (validation admin + reçu).
// ========================================
export const inscrireGratuit = async (req, res) => {
  try {
    const { nom, prenom, email, telephone, formationId, universite, promotion, filiere } = req.body;

    if (!nom || !prenom || !email || !telephone || !formationId) {
      return res.status(400).json({ success: false, message: 'Tous les champs sont obligatoires' });
    }

    // Université + filière obligatoires, promotion obligatoire si UNCHK
    const erreurInfos = verifierInfosGratuit({ universite, promotion, filiere });
    if (erreurInfos) {
      return res.status(400).json({ success: false, message: erreurInfos });
    }

    const emailNettoye = String(email).trim().toLowerCase();

    const formation = await prisma.formation.findUnique({
      where: { id: parseInt(formationId) }
    });
    if (!formation) {
      return res.status(404).json({ success: false, message: 'Formation introuvable' });
    }
    if (!formation.estActif) {
      return res.status(400).json({ success: false, message: "Cette formation n'est plus disponible" });
    }

    // Email déjà utilisé (inscription ou compte)
    const [inscriptionExistante, userExistant] = await Promise.all([
      prisma.inscription.findFirst({ where: { email: emailNettoye } }),
      prisma.user.findUnique({ where: { email: emailNettoye } }),
    ]);
    if (inscriptionExistante || userExistant) {
      return res.status(400).json({ success: false, message: 'Cet email est déjà inscrit' });
    }

    const code         = await genererCodeUnique();
    const passwordHash = await bcrypt.hash(code, 10);
    const infos        = normaliserInfosGratuit({ universite, promotion, filiere });

    // ── Inscription + compte créés ensemble (tout ou rien) ────────────────
    const [inscription] = await prisma.$transaction([
      prisma.inscription.create({
        data: {
          nom,
          prenom,
          email:              emailNettoye,
          telephone,
          formation:          formation.titre,
          code,
          status:             'VALIDATED',
          mode:               'GRATUIT',
          estActif:           true,
          dateDemarrage:      new Date(),
          dateFinFormation:   null,
          montantInscription: 0,
          nombreMois:         null,
          mensualite:         null,
          cohorte:            null,
          ...infos,
        }
      }),
      prisma.user.create({
        data: {
          nom:       `${prenom} ${nom}`,
          email:     emailNettoye,
          password:  passwordHash,
          role:      'USER',
          formation: formation.titre,
          cohorte:   null,
        }
      }),
    ]);
    console.log(`✅ Inscription gratuite + compte créés pour ${emailNettoye}`);

    // ── Message de bienvenue avec le code ──────────────────────────────────
    try {
      await envoyerEmailValidation({
        nomComplet:         `${prenom} ${nom}`,
        email:              emailNettoye,
        formation:          formation.titre,
        code,
        telephone,
        mode:               'GRATUIT',
        montantInscription: 0,
        nombreMois:         null,
        mensualite:         null,
        estPaiementUnique:  false,
        cohorte:            null,
        inscriptionId:      inscription.id,
        universite:         infos.universite,
        promotion:          infos.promotion,
        filiere:            infos.filiere,
      });
    } catch (emailError) {
      // Sans email, l'étudiant n'aurait aucun moyen de connaître son code :
      // on annule tout pour qu'il puisse réessayer proprement.
      console.error("❌ Email non envoyé, annulation de l'inscription gratuite:", emailError.message);
      await prisma.$transaction([
        prisma.user.delete({ where: { email: emailNettoye } }),
        prisma.inscription.delete({ where: { id: inscription.id } }),
      ]);
      return res.status(500).json({
        success: false,
        message: "Impossible d'envoyer l'email contenant votre code d'accès. Veuillez réessayer dans quelques minutes."
      });
    }

    res.status(201).json({
      success:       true,
      message:       "Inscription confirmée ! Votre code d'accès vous a été envoyé par email : utilisez-le pour vous connecter.",
      inscriptionId: inscription.id
    });

  } catch (error) {
    console.error('❌ Erreur inscription gratuite:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'inscription" });
  }
};

// ========================================
// 📌 PARTIE ADMIN
// ========================================

export const getInscriptionsPendantes = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = { status: 'PENDING' };
    if (formation) where.formation = { contains: formation, mode: 'insensitive' };
    if (cohorte)   where.cohorte   = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, count: inscriptions.length, inscriptions });

  } catch (error) {
    console.error('❌ Erreur récupération inscriptions:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
  }
};

// 🆕 Filtre optionnel ?mode=EN_LIGNE | PRESENTIEL | PONCTUEL | GRATUIT
export const getInscriptionsValidees = async (req, res) => {
  try {
    const { formation, cohorte, statut, mode } = req.query;

    const where = { status: 'VALIDATED' };
    if (formation)            where.formation = { contains: formation, mode: 'insensitive' };
    if (cohorte)              where.cohorte   = parseInt(cohorte);
    if (statut === 'actif')   where.estActif  = true;
    if (statut === 'inactif') where.estActif  = false;
    if (mode && MODES.includes(mode)) where.mode = mode;

    const inscriptions = await prisma.inscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        paiements: { where: { status: 'VALIDE' } },
      }
    });

    const inscriptionsEnrichies = inscriptions.map(ins => {
      const typePaiement = typePaiementDe(ins);
      const suiviMensuel = typePaiement === 'MENSUEL';

      return {
        ...ins,
        typePaiement,
        // Progression uniquement pour les paiements mensuels
        progression: suiviMensuel
          ? {
              moisPayes:    ins.paiements.length,
              moisRestants: (ins.nombreMois ?? 0) - ins.paiements.length,
              pourcentage:  ins.nombreMois && ins.nombreMois > 0
                ? Math.round((ins.paiements.length / ins.nombreMois) * 100)
                : 0
            }
          : null
      };
    });

    res.json({ success: true, count: inscriptionsEnrichies.length, inscriptions: inscriptionsEnrichies });

  } catch (error) {
    console.error('❌ Erreur récupération inscriptions validées:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
  }
};

// ========================================
// ✅ VALIDATION — le MODE est obligatoire
//
//  EN_LIGNE / PRESENTIEL
//    → body: { mode, montantInscription, nombreMois, cohorte, mensualite? , dateDemarrage? }
//    → mensualite absente / 0 = paiement unique
//
//  PONCTUEL
//    → body: { mode, montantInscription, dateDemarrage? }
//    → pas de cohorte, pas de mensualité
//
//  GRATUIT
//    → body: { mode, universite, filiere, promotion (si UNCHK), dateDemarrage? }
//    → pas de cohorte, pas de montant, pas de reçu
//
//  Dans tous les cas un compte User est créé et un message de bienvenue
//  est envoyé (avec reçu pour les modes payants).
//
//  dateDemarrage (optionnel) : si absent → date du jour.
// ========================================
export const validerInscription = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      mode, montantInscription, nombreMois, mensualite, cohorte, dateDemarrage,
      universite, promotion, filiere
    } = req.body;

    // ── Mode obligatoire ──────────────────────────────────────────────────
    if (!MODES.includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Le mode est obligatoire : EN_LIGNE, PRESENTIEL, PONCTUEL ou GRATUIT'
      });
    }

    // ── Champs obligatoires selon le mode ─────────────────────────────────
    if (estModePayant(mode)) {
      if (!montantInscription || !nombreMois || !cohorte) {
        return res.status(400).json({
          success: false,
          message: 'Les champs montantInscription, nombreMois et cohorte sont obligatoires'
        });
      }
    } else if (mode === 'PONCTUEL') {
      if (!montantInscription || parseInt(montantInscription) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Le montant est obligatoire pour une inscription ponctuelle'
        });
      }
    } else {
      // GRATUIT
      const erreurInfos = verifierInfosGratuit({ universite, promotion, filiere });
      if (erreurInfos) {
        return res.status(400).json({ success: false, message: erreurInfos });
      }
    }

    // Paiement unique = mode payant sans mensualité
    const estPaiementUnique = estModePayant(mode) && (!mensualite || parseInt(mensualite) === 0);

    const inscription = await prisma.inscription.findUnique({
      where: { id: parseInt(id) }
    });

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }
    if (inscription.status === 'VALIDATED') {
      return res.status(400).json({ success: false, message: 'Cette inscription est déjà validée' });
    }

    // ── Créer le compte User ──────────────────────────────────────────────
    const existingUser = await prisma.user.findUnique({ where: { email: inscription.email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Un compte existe déjà avec cet email' });
    }

    const passwordHash = await bcrypt.hash(inscription.code, 10);

    await prisma.user.create({
      data: {
        nom:       `${inscription.prenom} ${inscription.nom}`,
        email:     inscription.email,
        password:  passwordHash,
        role:      'USER',
        formation: inscription.formation,
        // Cohorte uniquement pour les modes EN_LIGNE / PRESENTIEL
        cohorte:   estModePayant(mode) ? parseInt(cohorte) : null,
      }
    });
    console.log(`✅ Compte User créé pour ${inscription.email}`);

    // ── Date de démarrage réelle + date de fin calculée ───────────────────
    // Par défaut : date du jour (= date de validation admin).
    // La date de fin n'existe que pour les modes payants (durée en mois).
    const dateDebut = dateDemarrage ? new Date(dateDemarrage) : new Date();
    const dateFin   = estModePayant(mode)
      ? calculerDateFinFormation(dateDebut, nombreMois)
      : null;

    // ── Données propres à chaque mode ─────────────────────────────────────
    let donneesMode;
    if (estModePayant(mode)) {
      donneesMode = {
        montantInscription: parseInt(montantInscription),
        nombreMois:         parseInt(nombreMois),
        mensualite:         estPaiementUnique ? null : parseInt(mensualite),
        cohorte:            parseInt(cohorte),
      };
    } else if (mode === 'PONCTUEL') {
      donneesMode = {
        montantInscription: parseInt(montantInscription),
        nombreMois:         null,
        mensualite:         null,
        cohorte:            null,
      };
    } else {
      donneesMode = {
        montantInscription: 0,
        nombreMois:         null,
        mensualite:         null,
        cohorte:            null,
        ...normaliserInfosGratuit({ universite, promotion, filiere }),
      };
    }

    // ── Mettre à jour l'inscription ───────────────────────────────────────
    const inscriptionValidee = await prisma.inscription.update({
      where: { id: parseInt(id) },
      data: {
        status:           'VALIDATED',
        mode,
        estActif:         true,
        dateDemarrage:    dateDebut,
        dateFinFormation: dateFin,
        ...donneesMode
      }
    });

    // ── Synchroniser le User (formation + cohorte) ────────────────────────
    await prisma.user.update({
      where: { email: inscriptionValidee.email },
      data: {
        formation: inscriptionValidee.formation,
        cohorte:   inscriptionValidee.cohorte,   // null pour PONCTUEL / GRATUIT
      }
    });
    console.log(`✅ User synchronisé pour ${inscriptionValidee.email}`);

    // ── Envoyer l'email de bienvenue (les 4 modes) ────────────────────────
    await envoyerEmailValidation({
      nomComplet:         `${inscriptionValidee.prenom} ${inscriptionValidee.nom}`,
      email:              inscriptionValidee.email,
      formation:          inscriptionValidee.formation,
      code:               inscriptionValidee.code,
      telephone:          inscriptionValidee.telephone,
      mode:               inscriptionValidee.mode,
      montantInscription: inscriptionValidee.montantInscription,
      nombreMois:         inscriptionValidee.nombreMois,
      mensualite:         inscriptionValidee.mensualite,  // null si paiement unique
      estPaiementUnique,
      cohorte:            inscriptionValidee.cohorte,
      inscriptionId:      inscriptionValidee.id,
      universite:         inscriptionValidee.universite,
      promotion:          inscriptionValidee.promotion,
      filiere:            inscriptionValidee.filiere
    });

    res.json({
      success:     true,
      message:     'Inscription validée avec succès !',
      inscription: {
        ...inscriptionValidee,
        typePaiement: typePaiementDe(inscriptionValidee)
      }
    });

  } catch (error) {
    console.error('❌ ERREUR validerInscription:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la validation' });
  }
};

// ========================================
// ✅ MODIFIER une inscription
//    Synchronise aussi le User associé
//
//    Champs modifiables :
//      nom, prenom, email, telephone, formation, cohorte, dateDemarrage
//      🆕 code            → met aussi à jour le mot de passe du User
//      🆕 mode            → EN_LIGNE / PRESENTIEL / PONCTUEL / GRATUIT
//      🆕 montantInscription, nombreMois, mensualite (selon le mode cible)
//      🆕 universite, promotion, filiere (mode GRATUIT)
//
//    Changement de mode (inscription VALIDATED uniquement) :
//      → GRATUIT      : université + filière (+ promotion si UNCHK) requises ;
//                       cohorte / montant / mensualité remis à zéro
//      → PONCTUEL     : montantInscription requis ; cohorte / mensualité retirées
//      → EN_LIGNE ou
//        PRESENTIEL   : montantInscription, nombreMois et cohorte requis
//                       (mensualite optionnelle = paiement unique) ;
//                       si l'étudiant venait de GRATUIT / PONCTUEL et qu'aucune
//                       dateDemarrage n'est fournie → date du jour
//                       (évite de le compter en retard sur les mois passés)
//
//    Un étudiant GRATUIT qui passe à un mode payant reçoit son reçu
//    avec le message de bienvenue. Les anciens paiements sont conservés.
// ========================================
export const modifierInscription = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nom, prenom, email, telephone, formation, cohorte, dateDemarrage, code,
      mode, montantInscription, nombreMois, mensualite,
      universite, promotion, filiere
    } = req.body;

    const inscription = await prisma.inscription.findUnique({
      where: { id: parseInt(id) }
    });

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }

    // Vérifier unicité email si changé
    if (email && email !== inscription.email) {
      const emailExistant = await prisma.inscription.findUnique({ where: { email } });
      if (emailExistant) {
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé par une autre inscription'
        });
      }
    }

    // ── 🆕 Code d'accès ───────────────────────────────────────────────────
    let nouveauCode = null;
    if (
      code !== undefined && code !== null &&
      String(code).trim() !== '' &&
      String(code).trim() !== inscription.code
    ) {
      nouveauCode = String(code).trim();

      if (nouveauCode.length < 4) {
        return res.status(400).json({
          success: false,
          message: 'Le code doit contenir au moins 4 caractères'
        });
      }

      const codeExistant = await prisma.inscription.findUnique({ where: { code: nouveauCode } });
      if (codeExistant) {
        return res.status(400).json({
          success: false,
          message: 'Ce code est déjà utilisé par un autre étudiant'
        });
      }
    }

    // ── 🆕 Mode ───────────────────────────────────────────────────────────
    if (mode !== undefined && !MODES.includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Mode invalide : EN_LIGNE, PRESENTIEL, PONCTUEL ou GRATUIT'
      });
    }

    const modeActuel     = inscription.mode;
    const modeCible      = mode ?? modeActuel;
    const changementMode = modeCible !== modeActuel;

    if (changementMode && inscription.status !== 'VALIDATED') {
      return res.status(400).json({
        success: false,
        message: "Le mode se choisit à la validation de l'inscription"
      });
    }

    // ── Données de base à mettre à jour ───────────────────────────────────
    const data = {
      ...(nom       && { nom }),
      ...(prenom    && { prenom }),
      ...(email     && { email }),
      ...(telephone && { telephone }),
      ...(formation && { formation }),
      ...(nouveauCode && { code: nouveauCode }),
    };

    const infosFournies =
      universite !== undefined || promotion !== undefined || filiere !== undefined;

    if (!changementMode) {
      // ── Pas de changement de mode : comportement habituel ───────────────
      // La cohorte n'a de sens que pour les modes EN_LIGNE / PRESENTIEL
      if (cohorte !== undefined && estModePayant(modeActuel)) {
        data.cohorte = cohorte ? parseInt(cohorte) : null;
      }

      if (dateDemarrage) {
        data.dateDemarrage = new Date(dateDemarrage);
        // Recalculer dateFinFormation en cohérence (modes payants uniquement)
        if (inscription.nombreMois) {
          data.dateFinFormation = calculerDateFinFormation(new Date(dateDemarrage), inscription.nombreMois);
        }
      }

      // Correction des infos d'un étudiant gratuit
      if (modeActuel === 'GRATUIT' && infosFournies) {
        const infos = {
          universite: universite !== undefined ? universite : inscription.universite,
          promotion:  promotion  !== undefined ? promotion  : inscription.promotion,
          filiere:    filiere    !== undefined ? filiere    : inscription.filiere,
        };
        const erreurInfos = verifierInfosGratuit(infos);
        if (erreurInfos) {
          return res.status(400).json({ success: false, message: erreurInfos });
        }
        Object.assign(data, normaliserInfosGratuit(infos));
      } else if (modeActuel !== 'GRATUIT' && infosFournies) {
        if (universite !== undefined) data.universite = universite || null;
        if (promotion  !== undefined) data.promotion  = promotion  || null;
        if (filiere    !== undefined) data.filiere    = filiere    || null;
      }

    } else {
      // ── Changement de mode ──────────────────────────────────────────────
      const etaitSansEcheancier = modeActuel === 'GRATUIT' || modeActuel === 'PONCTUEL';

      // Valeurs finales = valeurs envoyées, sinon valeurs actuelles
      const montantFinal    = montantInscription !== undefined && montantInscription !== ''
        ? parseInt(montantInscription) : inscription.montantInscription;
      const nombreMoisFinal = nombreMois !== undefined && nombreMois !== ''
        ? parseInt(nombreMois) : inscription.nombreMois;
      const mensualiteFinale = mensualite !== undefined
        ? (parseInt(mensualite) || null) : inscription.mensualite;
      const cohorteFinale   = cohorte !== undefined
        ? (cohorte ? parseInt(cohorte) : null) : inscription.cohorte;

      if (modeCible === 'GRATUIT') {
        const infos = {
          universite: universite !== undefined ? universite : inscription.universite,
          promotion:  promotion  !== undefined ? promotion  : inscription.promotion,
          filiere:    filiere    !== undefined ? filiere    : inscription.filiere,
        };
        const erreurInfos = verifierInfosGratuit(infos);
        if (erreurInfos) {
          return res.status(400).json({ success: false, message: erreurInfos });
        }

        Object.assign(data, {
          mode:               'GRATUIT',
          montantInscription: 0,
          nombreMois:         null,
          mensualite:         null,
          cohorte:            null,
          dateFinFormation:   null,
          ...normaliserInfosGratuit(infos),
        });

      } else if (modeCible === 'PONCTUEL') {
        if (!(montantFinal > 0)) {
          return res.status(400).json({
            success: false,
            message: 'Le montant est obligatoire pour passer en mode ponctuel'
          });
        }

        Object.assign(data, {
          mode:               'PONCTUEL',
          montantInscription: montantFinal,
          nombreMois:         null,
          mensualite:         null,
          cohorte:            null,
          dateFinFormation:   null,
        });

      } else {
        // EN_LIGNE ou PRESENTIEL
        if (!(montantFinal > 0) || !(nombreMoisFinal > 0) || !cohorteFinale) {
          return res.status(400).json({
            success: false,
            message: 'Pour ce mode, montantInscription, nombreMois et cohorte sont obligatoires'
          });
        }

        // Venant de GRATUIT / PONCTUEL : le suivi des paiements démarre maintenant,
        // sauf si l'admin fournit une date précise.
        const dateDebut = dateDemarrage
          ? new Date(dateDemarrage)
          : (etaitSansEcheancier ? new Date() : (inscription.dateDemarrage ?? new Date()));

        Object.assign(data, {
          mode:               modeCible,
          montantInscription: montantFinal,
          nombreMois:         nombreMoisFinal,
          mensualite:         mensualiteFinale,
          cohorte:            cohorteFinale,
          dateDemarrage:      dateDebut,
          dateFinFormation:   calculerDateFinFormation(dateDebut, nombreMoisFinal),
        });
      }

      // Date de démarrage explicite pour GRATUIT / PONCTUEL
      if (dateDemarrage && !data.dateDemarrage) {
        data.dateDemarrage = new Date(dateDemarrage);
      }
    }

    // ── Mettre à jour l'inscription ───────────────────────────────────────
    const inscriptionMaj = await prisma.inscription.update({
      where: { id: parseInt(id) },
      data
    });

    // ── Synchroniser le User si il existe ────────────────────────────────
    const ancienEmail  = inscription.email; // email AVANT modification
    const userExistant = await prisma.user.findUnique({ where: { email: ancienEmail } });

    if (userExistant) {
      // Le mot de passe du User est le hash du code : on le met à jour si le code change
      const nouveauHash = nouveauCode ? await bcrypt.hash(nouveauCode, 10) : null;

      await prisma.user.update({
        where: { email: ancienEmail },
        data: {
          // Recomposer le nom complet avec les valeurs à jour
          ...((nom || prenom) && {
            nom: `${inscriptionMaj.prenom} ${inscriptionMaj.nom}`
          }),
          // Propager le nouvel email dans User
          ...(email && email !== ancienEmail && { email }),
          ...(formation && { formation }),
          // Cohorte : uniquement si elle a été touchée (modification ou changement de mode)
          ...('cohorte' in data && { cohorte: data.cohorte }),
          ...(nouveauHash && { password: nouveauHash }),
        }
      });
      console.log(`✅ User synchronisé après modification pour ${ancienEmail}`);
    }

    // ── 🆕 GRATUIT → mode payant : reçu + message de bienvenue ────────────
    let emailEnvoye;
    if (changementMode && modeActuel === 'GRATUIT') {
      try {
        await envoyerEmailValidation({
          nomComplet:         `${inscriptionMaj.prenom} ${inscriptionMaj.nom}`,
          email:              inscriptionMaj.email,
          formation:          inscriptionMaj.formation,
          code:               inscriptionMaj.code,
          telephone:          inscriptionMaj.telephone,
          mode:               inscriptionMaj.mode,
          montantInscription: inscriptionMaj.montantInscription,
          nombreMois:         inscriptionMaj.nombreMois,
          mensualite:         inscriptionMaj.mensualite,
          estPaiementUnique:  estModePayant(inscriptionMaj.mode) && !inscriptionMaj.mensualite,
          cohorte:            inscriptionMaj.cohorte,
          inscriptionId:      inscriptionMaj.id
        });
        emailEnvoye = true;
      } catch (emailError) {
        console.error('❌ Erreur email (passage de gratuit à payant, non bloquant):', emailError.message);
        emailEnvoye = false;
      }
    }

    res.json({
      success: true,
      message: emailEnvoye === false
        ? "Inscription modifiée, mais l'email avec le reçu n'a pas pu être envoyé"
        : 'Inscription modifiée avec succès',
      inscription: { ...inscriptionMaj, typePaiement: typePaiementDe(inscriptionMaj) },
      ...(emailEnvoye !== undefined && { emailEnvoye })
    });

  } catch (error) {
    console.error('❌ Erreur modification:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la modification' });
  }
};

// ========================================
// ✅ SUPPRIMER une inscription
//    Synchronise aussi la suppression du User associé
// ========================================
export const supprimerInscription = async (req, res) => {
  try {
    const { id } = req.params;

    const inscription = await prisma.inscription.findUnique({
      where: { id: parseInt(id) }
    });

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }

    // ── 1. Supprimer les paiements liés (contrainte FK) ───────────────────
    await prisma.paiement.deleteMany({
      where: { inscriptionId: parseInt(id) }
    });

    // ── 2. Supprimer l'inscription ────────────────────────────────────────
    await prisma.inscription.delete({
      where: { id: parseInt(id) }
    });

    // ── 3. Supprimer le User associé s'il existe ──────────────────────────
    const userExistant = await prisma.user.findUnique({
      where: { email: inscription.email }
    });

    if (userExistant) {
      await prisma.user.delete({ where: { email: inscription.email } });
      console.log(`✅ User supprimé pour ${inscription.email}`);
    } else {
      console.log(`ℹ️ Aucun User trouvé pour ${inscription.email} (inscription PENDING non validée)`);
    }

    res.json({ success: true, message: 'Inscription et compte utilisateur supprimés avec succès' });

  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression' });
  }
};
// ========================================
// ✅ MARQUER INACTIF
// ========================================
export const marquerEtudiantInactif = async (req, res) => {
  try {
    const { id } = req.params;

    const inscription = await prisma.inscription.findUnique({ where: { id: parseInt(id) } });
    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }

    const inscriptionMaj = await prisma.inscription.update({
      where: { id: parseInt(id) },
      data: { estActif: false, dateFinFormation: new Date() }
    });

    res.json({ success: true, message: 'Étudiant marqué comme inactif', inscription: inscriptionMaj });

  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour' });
  }
};

// ========================================
// ✅ RÉACTIVER UN ÉTUDIANT
// ========================================
export const reactiverEtudiant = async (req, res) => {
  try {
    const { id } = req.params;

    const inscriptionMaj = await prisma.inscription.update({
      where: { id: parseInt(id) },
      data: { estActif: true, dateFinFormation: null }
    });

    res.json({ success: true, message: 'Étudiant réactivé', inscription: inscriptionMaj });

  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la réactivation' });
  }
};

// ========================================
// ✅ STATISTIQUES  (🆕 répartition par mode)
// ========================================
export const getStatistiques = async (req, res) => {
  try {
    const { cohorte, formation } = req.query;

    const whereBase = {};
    if (cohorte)   whereBase.cohorte   = parseInt(cohorte);
    if (formation) whereBase.formation = { contains: formation, mode: 'insensitive' };

    const [totalInscriptions, enAttente, validees, actifs, inactifs, parFormation, parCohorte, parMode] =
      await Promise.all([
        prisma.inscription.count({ where: whereBase }),
        prisma.inscription.count({ where: { ...whereBase, status: 'PENDING'   } }),
        prisma.inscription.count({ where: { ...whereBase, status: 'VALIDATED' } }),
        prisma.inscription.count({ where: { ...whereBase, status: 'VALIDATED', estActif: true  } }),
        prisma.inscription.count({ where: { ...whereBase, status: 'VALIDATED', estActif: false } }),
        prisma.inscription.groupBy({
          by: ['formation'],
          where: whereBase,
          _count: { formation: true },
          orderBy: { _count: { formation: 'desc' } }
        }),
        prisma.inscription.groupBy({
          by: ['cohorte'],
          where: { ...whereBase, cohorte: { not: null } },
          _count: { cohorte: true },
          orderBy: { cohorte: 'asc' }
        }),
        prisma.inscription.groupBy({
          by: ['mode'],
          where: { ...whereBase, status: 'VALIDATED' },
          _count: { mode: true }
        }),
      ]);

    res.json({
      success: true,
      stats: {
        total:       totalInscriptions,
        enAttente,
        validees,
        actifs,
        inactifs,
        parFormation: parFormation.map(f => ({ formation: f.formation, count: f._count.formation })),
        parCohorte:   parCohorte.map(c => ({ cohorte: c.cohorte, count: c._count.cohorte })),
        parMode:      parMode.map(m => ({ mode: m.mode, count: m._count.mode }))
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des statistiques' });
  }
};