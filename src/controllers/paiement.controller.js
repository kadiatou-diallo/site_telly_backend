import prisma from '../config/database.js';
import {
  genererRecuMensuelPDF,
  envoyerEmailPaiementValide,
  envoyerEmailRappelPaiement,
  slugMois
} from '../services/paiement-email.service.js';
import {
  formaterMoisCalendaire,
  genererMoisFormation,
  calculerDateFinFormation
} from '../utils/moisCalendaire.js';

// ========================================
// 🔧 HELPERS
// ========================================

// "Février 2026" si on connaît le mois calendaire, sinon "Mois 3" (anciennes données)
const libelleMois = (moisCalendaire, mois) =>
  moisCalendaire ? formaterMoisCalendaire(moisCalendaire) : `Mois ${mois}`;

// 🆕 Clé "2026-08" du mois N d'une inscription (null si pas de dateDemarrage).
//    RÈGLE : Mois 1 = le mois SUIVANT le démarrage.
//    Démarrage en Juillet → Mois 1 = Août, Mois 2 = Septembre, ...
const cleMoisCalendaire = (inscription, mois) => {
  if (!inscription?.dateDemarrage) return null;
  const d = new Date(inscription.dateDemarrage);
  const total = d.getFullYear() * 12 + d.getMonth() + mois;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

// 🆕 Libellé du mois d'un paiement, calculé depuis dateDemarrage (source de vérité).
//    On retombe sur le moisCalendaire enregistré seulement s'il n'y a pas de dateDemarrage.
const libellePaiement = (paiement, inscription) =>
  libelleMois(
    cleMoisCalendaire(inscription, paiement.mois) || paiement.moisCalendaire,
    paiement.mois
  );

// Génère le reçu PDF et l'envoie par email.
// Ne lève JAMAIS d'erreur : le paiement est déjà validé en base,
// un problème d'email ne doit pas faire croire à l'admin que la validation a échoué.
const envoyerRecuPaiement = async (paiement, inscription) => {
  const moisLabel = libellePaiement(paiement, inscription);
  try {
    const recuBuffer = await genererRecuMensuelPDF({
      nomComplet: `${inscription.prenom} ${inscription.nom}`,
      email: inscription.email,
      telephone: inscription.telephone,
      formation: inscription.formation,
      mois: paiement.mois,
      moisLabel,
      montant: paiement.montant,
      paiementId: paiement.id,
      dateValidation: paiement.dateValidation || new Date()
    });

    await envoyerEmailPaiementValide({
      nomComplet: `${inscription.prenom} ${inscription.nom}`,
      email: inscription.email,
      telephone: inscription.telephone,
      formation: inscription.formation,
      mois: paiement.mois,
      moisLabel,
      montant: paiement.montant,
      paiementId: paiement.id,
      recuBuffer
    });

    return { emailEnvoye: true };
  } catch (error) {
    console.error(`❌ Reçu/email non envoyé pour le paiement ${paiement.id}:`, error);
    return { emailEnvoye: false, erreurEmail: error.message };
  }
};

// ========================================
// 📌 PARTIE ÉTUDIANT (lecture seule)
// ========================================

export const getDashboardEtudiant = async (req, res) => {
  try {
    const { email } = req.params;

    const inscription = await prisma.inscription.findUnique({
      where: { email },
      include: {
        paiements: {
          orderBy: { mois: 'asc' }
        }
      }
    });

    if (!inscription) {
      return res.status(404).json({
        success: false,
        message: 'Inscription introuvable'
      });
    }

    const montantTotal = inscription.mensualite * inscription.nombreMois;

    const montantPaye = inscription.paiements
      .filter(p => p.status === 'VALIDE')
      .reduce((sum, p) => sum + p.montant, 0);

    const montantRestant = montantTotal - montantPaye;

    const totalPaiements = inscription.paiements.length;
    const paiementsValides = inscription.paiements.filter(p => p.status === 'VALIDE').length;
    const paiementsEnAttente = inscription.paiements.filter(p => p.status === 'EN_ATTENTE').length;
    // 🆕 Un paiement REJETE ne compte plus comme "payé"
    const paiementsNonPayes = inscription.nombreMois - paiementsValides - paiementsEnAttente;

    const paiementsFormates = inscription.paiements.map(p => ({
      id: p.id,
      mois: p.mois,
      moisCalendaire: cleMoisCalendaire(inscription, p.mois) || p.moisCalendaire,
      moisLabel: libellePaiement(p, inscription),
      montant: p.montant,
      status: p.status,
      dateValidation: p.dateValidation,
      createdAt: p.createdAt,
      urlTelechargement: p.status === 'VALIDE'
        ? `${process.env.API_URL || 'https://tellytech-backkend.vercel.app'}/api/paiements/etudiant/recu/${p.id}`
        : null
    }));

    // Calendrier complet de la formation (mois payés + mois à venir)
    const calendrierFormation = inscription.dateDemarrage
      ? genererMoisFormation(inscription.dateDemarrage, inscription.nombreMois)
      : [];

    res.json({
      success: true,
      etudiant: {
        nom: inscription.nom,
        prenom: inscription.prenom,
        email: inscription.email,
        telephone: inscription.telephone,
        formation: inscription.formation,
        cohorte: inscription.cohorte,
        nombreMois: inscription.nombreMois,
        mensualite: inscription.mensualite,
        montantInscription: inscription.montantInscription || 0,
        estActif: inscription.estActif,
        dateDemarrage: inscription.dateDemarrage,
        dateFinFormation: inscription.dateFinFormation
      },
      statistiques: {
        totalMois: inscription.nombreMois,
        paiementsValides,
        paiementsEnAttente,
        paiementsNonPayes,
        montantTotal,
        montantPaye,
        montantRestant
      },
      paiements: paiementsFormates,
      calendrierFormation
    });

  } catch (error) {
    console.error('❌ Erreur dashboard étudiant:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du dashboard'
    });
  }
};

// ❌ demanderPaiement supprimé : l'étudiant ne peut plus faire de demande.
//    Seul l'admin enregistre/valide un paiement (voir enregistrerPaiementAdmin).

// ✅ Téléchargement du reçu en Buffer
export const telechargerRecu = async (req, res) => {
  try {
    const { paiementId } = req.params;

    const paiement = await prisma.paiement.findUnique({
      where: { id: parseInt(paiementId) },
      include: { inscription: true }
    });

    if (!paiement) {
      return res.status(404).json({
        success: false,
        message: 'Paiement introuvable'
      });
    }

    if (paiement.status !== 'VALIDE') {
      return res.status(400).json({
        success: false,
        message: 'Ce paiement n\'est pas encore validé'
      });
    }

    // Mois calendaire : recalculé depuis dateDemarrage (Mois 1 = mois suivant le démarrage)
    const moisLabel = libellePaiement(paiement, paiement.inscription);

    console.log('⚙️ Génération du PDF en mémoire...');

    const pdfBuffer = await genererRecuMensuelPDF({
      nomComplet: `${paiement.inscription.prenom} ${paiement.inscription.nom}`,
      email: paiement.inscription.email,
      telephone: paiement.inscription.telephone,
      formation: paiement.inscription.formation,
      mois: paiement.mois,
      moisLabel,
      montant: paiement.montant,
      paiementId: paiement.id,
      dateValidation: paiement.dateValidation || new Date()
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Recu_${slugMois(moisLabel)}_TellyTech.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');

    res.send(pdfBuffer);

    console.log('✅ PDF envoyé avec succès');

  } catch (error) {
    console.error('❌ Erreur téléchargement reçu:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du téléchargement du reçu',
      error: error.message
    });
  }
};

// ======================================== 
// 📌 PARTIE ADMIN
// ======================================== 

// ========================================
// 🆕 ADMIN : enregistrer + valider un mois en UNE action
//    (plus de demande étudiant)
//
// POST /admin/inscription/:inscriptionId/enregistrer
// body : { mois: 3 }                      → montant = mensualité
//        { mois: 3, montant: 25000 }      → montant personnalisé (optionnel)
//
// Protections contre les doublons :
//  - refuse si le mois est déjà VALIDE (409)
//  - mise à jour conditionnelle (status != VALIDE) → un double clic ne passe qu'une fois
//  - contrainte unique (inscriptionId, mois) en base (voir schema.prisma)
// ========================================
export const enregistrerPaiementAdmin = async (req, res) => {
  try {
    const inscriptionId = parseInt(req.params.inscriptionId);
    const mois = parseInt(req.body.mois);

    if (!Number.isInteger(mois) || mois < 1) {
      return res.status(400).json({
        success: false,
        message: 'Le mois est obligatoire'
      });
    }

    const inscription = await prisma.inscription.findUnique({
      where: { id: inscriptionId }
    });

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }

    if (inscription.status !== 'VALIDATED') {
      return res.status(400).json({
        success: false,
        message: 'Cette inscription n\'est pas encore validée'
      });
    }

    if (!inscription.mensualite) {
      return res.status(400).json({
        success: false,
        message: 'Cet étudiant est en paiement unique : aucune mensualité à enregistrer'
      });
    }

    if (mois > inscription.nombreMois) {
      return res.status(400).json({
        success: false,
        message: `Le mois ${mois} dépasse la durée de la formation (${inscription.nombreMois} mois). Cliquez d'abord sur « Ajouter un mois ».`
      });
    }

    const existant = await prisma.paiement.findFirst({
      where: { inscriptionId, mois }
    });

    if (existant && existant.status === 'VALIDE') {
      return res.status(409).json({
        success: false,
        message: `Le mois ${mois} est déjà validé`
      });
    }

    const montant = req.body.montant
      ? parseInt(req.body.montant)
      : (existant?.montant || inscription.mensualite);

    if (!Number.isInteger(montant) || montant <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide' });
    }

    const moisCalendaire = cleMoisCalendaire(inscription, mois);
    const maintenant = new Date();
    let paiementValide;

    if (existant) {
      // Ancienne demande EN_ATTENTE / REJETE pour ce mois → on la passe en VALIDE.
      // La condition status != VALIDE garantit qu'un double clic ne valide qu'une fois.
      const resultat = await prisma.paiement.updateMany({
        where: { id: existant.id, status: { not: 'VALIDE' } },
        data: {
          status: 'VALIDE',
          montant,
          moisCalendaire,
          dateValidation: maintenant
        }
      });

      if (resultat.count === 0) {
        return res.status(409).json({
          success: false,
          message: `Le mois ${mois} vient d'être validé`
        });
      }

      paiementValide = await prisma.paiement.findUnique({ where: { id: existant.id } });
    } else {
      try {
        paiementValide = await prisma.paiement.create({
          data: {
            inscriptionId,
            mois,
            moisCalendaire,
            montant,
            status: 'VALIDE',
            dateValidation: maintenant
          }
        });
      } catch (e) {
        // P2002 = violation de la contrainte unique (double clic simultané)
        if (e.code === 'P2002') {
          return res.status(409).json({
            success: false,
            message: `Le mois ${mois} vient d'être validé`
          });
        }
        throw e;
      }
    }

    const moisLabel = libellePaiement(paiementValide, inscription);
    const { emailEnvoye, erreurEmail } = await envoyerRecuPaiement(paiementValide, inscription);

    res.status(201).json({
      success: true,
      message: emailEnvoye
        ? `Paiement de ${moisLabel} validé. Reçu envoyé à l'étudiant.`
        : `Paiement de ${moisLabel} validé, mais l'email n'a pas pu être envoyé. Le reçu reste téléchargeable.`,
      emailEnvoye,
      erreurEmail,
      paiement: { ...paiementValide, moisLabel }
    });

  } catch (error) {
    console.error('❌ Erreur enregistrement paiement admin:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'enregistrement du paiement',
      error: error.message
    });
  }
};

// ========================================
// 🆕 ADMIN : « Ajouter un mois » (l'étudiant dure plus longtemps)
//    7 → 8 mois, dateFinFormation recalculée.
//    Le nouveau mois apparaît "non payé" et se valide ensuite normalement.
//
// POST /admin/inscription/:inscriptionId/ajouter-mois
// ========================================
export const ajouterMoisSupplementaire = async (req, res) => {
  try {
    const inscriptionId = parseInt(req.params.inscriptionId);

    const inscription = await prisma.inscription.findUnique({
      where: { id: inscriptionId }
    });

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscription introuvable' });
    }

    if (inscription.status !== 'VALIDATED') {
      return res.status(400).json({
        success: false,
        message: 'Cette inscription n\'est pas encore validée'
      });
    }

    if (!inscription.mensualite) {
      return res.status(400).json({
        success: false,
        message: 'Paiement unique : impossible d\'ajouter un mois'
      });
    }

    const ancienNombre = inscription.nombreMois;
    const nouveauNombre = ancienNombre + 1;

    // Mise à jour conditionnelle : si deux clics arrivent en même temps,
    // un seul mois est ajouté (le second voit nombreMois déjà modifié).
    const resultat = await prisma.inscription.updateMany({
      where: { id: inscriptionId, nombreMois: ancienNombre },
      data: { nombreMois: nouveauNombre }
    });

    if (resultat.count === 0) {
      return res.status(409).json({
        success: false,
        message: 'Le nombre de mois vient d\'être modifié. Rafraîchissez la page.'
      });
    }

    // Recalcul de la date de fin (uniquement si l'étudiant est actif ;
    // pour un étudiant inactif, dateFinFormation = date de sortie, on n'y touche pas)
    let dateFinFormation = inscription.dateFinFormation;
    if (inscription.estActif && inscription.dateDemarrage) {
      dateFinFormation = calculerDateFinFormation(inscription.dateDemarrage, nouveauNombre);
      await prisma.inscription.update({
        where: { id: inscriptionId },
        data: { dateFinFormation }
      });
    }

    const moisCalendaire = cleMoisCalendaire(inscription, nouveauNombre);

    res.json({
      success: true,
      message: `Mois ajouté : la formation passe à ${nouveauNombre} mois.`,
      nombreMois: nouveauNombre,
      dateFinFormation,
      nouveauMois: {
        mois: nouveauNombre,
        moisLabel: libelleMois(moisCalendaire, nouveauNombre),
        statut: 'NON_PAYE'
      }
    });

  } catch (error) {
    console.error('❌ Erreur ajout mois:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout du mois',
      error: error.message
    });
  }
};

// Anciennes demandes EN_ATTENTE (créées avant le changement) — à traiter puis la liste se vide
export const getPaiementsEnAttente = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = { status: 'EN_ATTENTE' };
    const inscriptionWhere = {};

    if (formation) inscriptionWhere.formation = formation;
    if (cohorte) inscriptionWhere.cohorte = parseInt(cohorte);

    if (Object.keys(inscriptionWhere).length > 0) {
      where.inscription = inscriptionWhere;
    }

    const paiements = await prisma.paiement.findMany({
      where,
      include: { inscription: true },
      orderBy: { createdAt: 'desc' }
    });

    const paiementsFormates = paiements.map(p => ({
      id: p.id,
      etudiant: `${p.inscription.prenom} ${p.inscription.nom}`,
      email: p.inscription.email,
      telephone: p.inscription.telephone,
      formation: p.inscription.formation,
      cohorte: p.inscription.cohorte,
      mois: p.mois,
      moisLabel: libellePaiement(p, p.inscription),
      montant: p.montant,
      dateDemande: p.createdAt
    }));

    res.json({
      success: true,
      count: paiementsFormates.length,
      paiements: paiementsFormates
    });

  } catch (error) {
    console.error('❌ Erreur récupération paiements:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
};

export const getPaiementsValides = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = { status: 'VALIDE' };
    const inscriptionWhere = {};

    if (formation) inscriptionWhere.formation = formation;
    if (cohorte) inscriptionWhere.cohorte = parseInt(cohorte);

    if (Object.keys(inscriptionWhere).length > 0) {
      where.inscription = inscriptionWhere;
    }

    const paiements = await prisma.paiement.findMany({
      where,
      include: { inscription: true },
      orderBy: { dateValidation: 'desc' }
    });

    const paiementsFormates = paiements.map(p => ({
      id: p.id,
      etudiant: `${p.inscription.prenom} ${p.inscription.nom}`,
      email: p.inscription.email,
      formation: p.inscription.formation,
      cohorte: p.inscription.cohorte,
      mois: p.mois,
      moisLabel: libellePaiement(p, p.inscription),
      montant: p.montant,
      dateValidation: p.dateValidation
    }));

    res.json({
      success: true,
      count: paiementsFormates.length,
      paiements: paiementsFormates
    });

  } catch (error) {
    console.error('❌ Erreur récupération paiements validés:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
};

export const getEtudiantsPaiementsNonPayes = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = {
      status: 'VALIDATED',
      estActif: true
    };

    if (formation) where.formation = formation;
    if (cohorte) where.cohorte = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where,
      include: {
        paiements: {
          where: { status: 'VALIDE' }
        }
      }
    });

    const etudiantsAvecRetard = inscriptions
      .map(inscription => {
        const moisPayes = inscription.paiements.length;
        const moisNonPayes = inscription.nombreMois - moisPayes;

        if (moisNonPayes > 0) {
          const moisPayesListe = inscription.paiements.map(p => p.mois);
          const moisManquants = [];
          for (let i = 1; i <= inscription.nombreMois; i++) {
            if (!moisPayesListe.includes(i)) {
              moisManquants.push(i);
            }
          }

          // Version lisible des mois manquants ("Août 2026", "Septembre 2026"...)
          const moisManquantsLabels = inscription.dateDemarrage
            ? moisManquants.map(m => formaterMoisCalendaire(cleMoisCalendaire(inscription, m)))
            : [];

          return {
            id: inscription.id,
            etudiant: `${inscription.prenom} ${inscription.nom}`,
            email: inscription.email,
            telephone: inscription.telephone,
            formation: inscription.formation,
            cohorte: inscription.cohorte,
            nombreMoisTotal: inscription.nombreMois,
            moisPayes,
            moisNonPayes,
            moisManquants,
            moisManquantsLabels,
            dateInscription: inscription.createdAt
          };
        }
        return null;
      })
      .filter(e => e !== null);

    res.json({
      success: true,
      count: etudiantsAvecRetard.length,
      etudiants: etudiantsAvecRetard
    });

  } catch (error) {
    console.error('❌ Erreur récupération étudiants non payés:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
};

export const envoyerRappelsPaiements = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const where = {
      status: 'VALIDATED',
      estActif: true
    };

    if (formation) where.formation = formation;
    if (cohorte) where.cohorte = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where,
      include: {
        paiements: {
          where: { status: 'VALIDE' }
        }
      }
    });

    const rappelsEnvoyes = [];
    const erreursEnvoi = [];

    for (const inscription of inscriptions) {
      const moisPayes = inscription.paiements.length;
      const moisNonPayes = inscription.nombreMois - moisPayes;

      if (moisNonPayes > 0) {
        const moisPayesListe = inscription.paiements.map(p => p.mois);
        const moisManquants = [];
        for (let i = 1; i <= inscription.nombreMois; i++) {
          if (!moisPayesListe.includes(i)) {
            moisManquants.push(i);
          }
        }

        // Toujours du texte : "Août 2026" (ou "Mois 3" si pas de dateDemarrage)
        const moisManquantsAffiches = moisManquants.map(m =>
          inscription.dateDemarrage
            ? formaterMoisCalendaire(cleMoisCalendaire(inscription, m))
            : `Mois ${m}`
        );

        try {
          await envoyerEmailRappelPaiement({
            nomComplet: `${inscription.prenom} ${inscription.nom}`,
            email: inscription.email,
            formation: inscription.formation,
            moisManquants: moisManquantsAffiches,
            montantMensuel: inscription.mensualite
          });

          rappelsEnvoyes.push({
            email: inscription.email,
            nom: `${inscription.prenom} ${inscription.nom}`,
            moisManquants: moisManquantsAffiches
          });
        } catch (error) {
          console.error(`❌ Erreur envoi rappel pour ${inscription.email}:`, error);
          erreursEnvoi.push({
            email: inscription.email,
            erreur: error.message
          });
        }
      }
    }

    res.json({
      success: true,
      message: `${rappelsEnvoyes.length} rappel(s) envoyé(s) avec succès`,
      rappelsEnvoyes,
      erreursEnvoi: erreursEnvoi.length > 0 ? erreursEnvoi : undefined
    });

  } catch (error) {
    console.error('❌ Erreur envoi rappels:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi des rappels'
    });
  }
};

// 📊 STATISTIQUES DÉTAILLÉES PAR MOIS - VERSION SIMPLIFIÉE (mois relatif, historique)
export const getStatistiquesDetailleesParMois = async (req, res) => {
  try {
    const { formation, mois, cohorte } = req.query;

    console.log('📊 Filtres reçus:', { formation, mois, cohorte });

    const whereInscription = {
      status: 'VALIDATED',
      estActif: true
    };

    if (formation) whereInscription.formation = formation;
    if (cohorte) whereInscription.cohorte = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where: whereInscription,
      include: {
        paiements: {
          where: { status: 'VALIDE' }
        }
      }
    });

    console.log(`👥 ${inscriptions.length} étudiant(s) actif(s) trouvé(s)`);

    if (mois) {
      const moisNum = parseInt(mois);
      console.log(`🔍 Filtrage pour le mois ${moisNum}`);

      const statsParFormation = {};

      for (const inscription of inscriptions) {
        const formationNom = inscription.formation;

        if (!statsParFormation[formationNom]) {
          statsParFormation[formationNom] = {
            formation: formationNom,
            mois: moisNum,
            etudiantsActifs: 0,
            etudiantsDoiventPayer: 0,
            etudiantsOntPaye: 0,
            etudiantsNonPaye: 0,
            revenus: 0,
            detailsEtudiants: []
          };
        }

        statsParFormation[formationNom].etudiantsActifs++;

        const doitPayerCeMois = inscription.nombreMois >= moisNum;

        if (doitPayerCeMois) {
          statsParFormation[formationNom].etudiantsDoiventPayer++;

          const aPaye = inscription.paiements.some(p => p.mois === moisNum);

          if (aPaye) {
            statsParFormation[formationNom].etudiantsOntPaye++;
            statsParFormation[formationNom].revenus += inscription.mensualite;
          } else {
            statsParFormation[formationNom].etudiantsNonPaye++;
          }

          statsParFormation[formationNom].detailsEtudiants.push({
            nom: `${inscription.prenom} ${inscription.nom}`,
            nombreMois: inscription.nombreMois,
            aPaye,
            paiementsValidesM: inscription.paiements.map(p => p.mois)
          });
        }
      }

      for (const formationNom in statsParFormation) {
        const stats = statsParFormation[formationNom];
        stats.tauxPaiement = stats.etudiantsDoiventPayer > 0
          ? `${((stats.etudiantsOntPaye / stats.etudiantsDoiventPayer) * 100).toFixed(1)}%`
          : '0%';
      }

      const statsArray = Object.values(statsParFormation);

      return res.json({
        success: true,
        stats: statsArray,
        filtreMois: moisNum,
        filtreFormation: formation || null,
        filtreCohorte: cohorte ? parseInt(cohorte) : null
      });
    }

    const statsParFormation = {};

    for (const inscription of inscriptions) {
      const formationNom = inscription.formation;

      if (!statsParFormation[formationNom]) {
        statsParFormation[formationNom] = {
          formation: formationNom,
          totalEtudiants: 0,
          totalMoisAttendus: 0,
          totalMoisPayes: 0,
          totalMoisNonPayes: 0,
          revenus: 0
        };
      }

      statsParFormation[formationNom].totalEtudiants++;
      statsParFormation[formationNom].totalMoisAttendus += inscription.nombreMois;
      statsParFormation[formationNom].totalMoisPayes += inscription.paiements.length;

      const revenusEtudiant = inscription.paiements.reduce((sum, p) => sum + p.montant, 0);
      statsParFormation[formationNom].revenus += revenusEtudiant;
    }

    for (const formationNom in statsParFormation) {
      const stats = statsParFormation[formationNom];
      stats.totalMoisNonPayes = stats.totalMoisAttendus - stats.totalMoisPayes;
      stats.tauxPaiement = stats.totalMoisAttendus > 0
        ? `${((stats.totalMoisPayes / stats.totalMoisAttendus) * 100).toFixed(1)}%`
        : '0%';
    }

    const statsArray = Object.values(statsParFormation);

    res.json({
      success: true,
      stats: statsArray,
      filtreMois: null,
      filtreFormation: formation || null,
      filtreCohorte: cohorte ? parseInt(cohorte) : null
    });

  } catch (error) {
    console.error('❌ Erreur stats détaillées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques détaillées',
      error: error.message
    });
  }
};

// ========================================
// 📊 STATISTIQUES PAR MOIS CALENDAIRE RÉEL
//
// Contrairement à getStatistiquesDetailleesParMois (qui groupe par mois
// RELATIF, ex: "Mois 3" de chaque étudiant), cet endpoint groupe par mois
// CALENDAIRE réel (ex: "Février 2026"), toutes cohortes/dates de démarrage
// confondues. C'est la vraie réponse à "combien j'ai reçu en Février 2026 ?"
//
// 🆕 Le mois calendaire est recalculé depuis dateDemarrage
//    (Mois 1 = mois suivant le démarrage) : plus besoin de backfill.
//
// Query params optionnels : formation, cohorte
// ========================================
export const getRevenusParMoisCalendaire = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const whereInscription = {
      status: 'VALIDATED'
    };
    if (formation) whereInscription.formation = formation;
    if (cohorte) whereInscription.cohorte = parseInt(cohorte);

    const paiements = await prisma.paiement.findMany({
      where: {
        status: 'VALIDE',
        inscription: whereInscription
      },
      include: { inscription: true }
    });

    // Regrouper par mois calendaire ("2026-02")
    const groupes = {};
    for (const p of paiements) {
      const cle = cleMoisCalendaire(p.inscription, p.mois) || p.moisCalendaire;
      if (!cle) continue; // ni date de démarrage ni mois enregistré : impossible à placer

      if (!groupes[cle]) {
        groupes[cle] = {
          moisCalendaire: cle,
          moisLabel: formaterMoisCalendaire(cle),
          nombrePaiements: 0,
          revenus: 0,
          etudiants: []
        };
      }
      groupes[cle].nombrePaiements++;
      groupes[cle].revenus += p.montant;
      groupes[cle].etudiants.push({
        nom: `${p.inscription.prenom} ${p.inscription.nom}`,
        email: p.inscription.email,
        formation: p.inscription.formation,
        montant: p.montant
      });
    }

    // Trier chronologiquement par clé "YYYY-MM"
    const statsParMois = Object.values(groupes).sort((a, b) =>
      a.moisCalendaire.localeCompare(b.moisCalendaire)
    );

    if (statsParMois.length === 0) {
      return res.json({
        success: true,
        message: "Aucun paiement à placer dans le calendrier (date de démarrage manquante ?).",
        statsParMois: []
      });
    }

    res.json({
      success: true,
      filtreFormation: formation || null,
      filtreCohorte: cohorte ? parseInt(cohorte) : null,
      statsParMois
    });

  } catch (error) {
    console.error('❌ Erreur stats par mois calendaire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques par mois calendaire',
      error: error.message
    });
  }
};

// ✅ Validation d'une ancienne demande EN_ATTENTE (par id de paiement).
//    Pour les nouveaux paiements, utiliser enregistrerPaiementAdmin.
//    Protégée contre le double clic ; n'échoue pas si l'email plante.
export const validerPaiement = async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const paiement = await prisma.paiement.findUnique({
      where: { id },
      include: { inscription: true }
    });

    if (!paiement) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    }

    if (paiement.status === 'VALIDE') {
      return res.status(400).json({ success: false, message: 'Ce paiement est déjà validé' });
    }

    // Recalculé depuis dateDemarrage (Mois 1 = mois suivant le démarrage)
    const moisCalendaire = cleMoisCalendaire(paiement.inscription, paiement.mois)
      || paiement.moisCalendaire;

    // Mise à jour conditionnelle : protège contre le double clic
    const resultat = await prisma.paiement.updateMany({
      where: { id, status: { not: 'VALIDE' } },
      data: {
        status: 'VALIDE',
        dateValidation: new Date(),
        moisCalendaire
      }
    });

    if (resultat.count === 0) {
      return res.status(409).json({ success: false, message: 'Ce paiement vient d\'être validé' });
    }

    const paiementValide = await prisma.paiement.findUnique({ where: { id } });
    const moisLabel = libellePaiement(paiementValide, paiement.inscription);
    const { emailEnvoye, erreurEmail } = await envoyerRecuPaiement(paiementValide, paiement.inscription);

    res.json({
      success: true,
      message: emailEnvoye
        ? `Paiement de ${moisLabel} validé. Reçu envoyé à l'étudiant.`
        : `Paiement de ${moisLabel} validé, mais l'email n'a pas pu être envoyé.`,
      emailEnvoye,
      erreurEmail,
      paiement: { ...paiementValide, moisLabel }
    });

  } catch (error) {
    console.error('❌ Erreur validation paiement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation',
      error: error.message
    });
  }
};

export const rejeterPaiement = async (req, res) => {
  try {
    const { id } = req.params;

    const paiement = await prisma.paiement.findUnique({
      where: { id: parseInt(id) }
    });

    if (!paiement) {
      return res.status(404).json({
        success: false,
        message: 'Paiement introuvable'
      });
    }

    const paiementRejete = await prisma.paiement.update({
      where: { id: parseInt(id) },
      data: { status: 'REJETE' }
    });

    res.json({
      success: true,
      message: 'Paiement rejeté',
      paiement: paiementRejete
    });

  } catch (error) {
    console.error('❌ Erreur rejet paiement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du rejet'
    });
  }
};

export const getStatistiquesPaiements = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const inscriptionWhere = {
      status: 'VALIDATED',
      estActif: true
    };

    if (formation) inscriptionWhere.formation = formation;
    if (cohorte) inscriptionWhere.cohorte = parseInt(cohorte);

    const where = { inscription: inscriptionWhere };

    const totalPaiements = await prisma.paiement.count({ where });
    const enAttente = await prisma.paiement.count({
      where: { ...where, status: 'EN_ATTENTE' }
    });
    const valides = await prisma.paiement.count({
      where: { ...where, status: 'VALIDE' }
    });
    const rejetes = await prisma.paiement.count({
      where: { ...where, status: 'REJETE' }
    });

    const revenus = await prisma.paiement.aggregate({
      where: { ...where, status: 'VALIDE' },
      _sum: { montant: true }
    });

    const statsParFormation = await prisma.inscription.groupBy({
      by: ['formation'],
      where: inscriptionWhere,
      _count: { id: true },
      _sum: { nombreMois: true }
    });

    const formationsDetails = await Promise.all(
      statsParFormation.map(async (stat) => {
        const paiementsFormation = await prisma.paiement.count({
          where: {
            status: 'VALIDE',
            inscription: {
              formation: stat.formation,
              estActif: true
            }
          }
        });

        const revenusFormation = await prisma.paiement.aggregate({
          where: {
            status: 'VALIDE',
            inscription: {
              formation: stat.formation,
              estActif: true
            }
          },
          _sum: { montant: true }
        });

        const moisAttendus = stat._sum.nombreMois || 0;
        const moisPayes = paiementsFormation;
        const moisNonPayes = moisAttendus - moisPayes;

        return {
          formation: stat.formation,
          nombreEtudiants: stat._count.id,
          moisAttendus,
          moisPayes,
          moisNonPayes,
          tauxPaiement: moisAttendus > 0
            ? ((moisPayes / moisAttendus) * 100).toFixed(2) + '%'
            : '0%',
          revenus: revenusFormation._sum.montant || 0
        };
      })
    );

    res.json({
      success: true,
      stats: {
        total: totalPaiements,
        enAttente,
        valides,
        rejetes,
        revenus: revenus._sum.montant || 0
      },
      statsParFormation: formationsDetails
    });

  } catch (error) {
    console.error('❌ Erreur stats paiements:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
};


// 📊 STATISTIQUES PAR MOIS - VERSION INTELLIGENTE (mois relatif)
export const getStatistiquesParMois = async (req, res) => {
  try {
    const { formation, cohorte } = req.query;

    const whereInscription = {
      status: 'VALIDATED',
      estActif: true
    };

    if (formation) whereInscription.formation = formation;
    if (cohorte) whereInscription.cohorte = parseInt(cohorte);

    const inscriptions = await prisma.inscription.findMany({
      where: whereInscription,
      include: {
        paiements: {
          where: { status: 'VALIDE' }
        }
      },
      orderBy: { nom: 'asc' }
    });

    if (inscriptions.length === 0) {
      return res.json({
        success: true,
        formation: formation || 'Toutes',
        cohorte: cohorte || 'Toutes',
        totalEtudiants: 0,
        statsMois: [],
        etudiants: []
      });
    }

    const maxMois = Math.max(...inscriptions.map(i => i.nombreMois));

    const statsMois = [];

    for (let mois = 1; mois <= maxMois; mois++) {
      let doiventPayer = 0;
      let ontPaye = 0;

      for (const inscription of inscriptions) {
        if (inscription.nombreMois >= mois) {
          doiventPayer++;

          const aPaye = inscription.paiements.some(p => p.mois === mois);
          if (aPaye) {
            ontPaye++;
          }
        }
      }

      const nonPaye = doiventPayer - ontPaye;
      const tauxPaiement = doiventPayer > 0
        ? ((ontPaye / doiventPayer) * 100).toFixed(1)
        : '0';

      statsMois.push({
        mois,
        doiventPayer,
        ontPaye,
        nonPaye,
        tauxPaiement: `${tauxPaiement}%`,
        montantAttendu: doiventPayer * (inscriptions[0]?.mensualite || 0),
        montantPercu: ontPaye * (inscriptions[0]?.mensualite || 0)
      });
    }

    const etudiants = inscriptions.map(inscription => {
      const moisPayesListe = inscription.paiements.map(p => p.mois).sort((a, b) => a - b);
      const moisManquants = [];

      for (let i = 1; i <= inscription.nombreMois; i++) {
        if (!moisPayesListe.includes(i)) {
          moisManquants.push(i);
        }
      }

      const montantTotal = inscription.mensualite * inscription.nombreMois;
      const montantPaye = inscription.paiements.reduce((sum, p) => sum + p.montant, 0);
      const montantRestant = montantTotal - montantPaye;

      return {
        id: inscription.id,
        nom: inscription.nom,
        prenom: inscription.prenom,
        nomComplet: `${inscription.prenom} ${inscription.nom}`,
        email: inscription.email,
        telephone: inscription.telephone,
        formation: inscription.formation,
        cohorte: inscription.cohorte,
        nombreMois: inscription.nombreMois,
        mensualite: inscription.mensualite,

        moisPayes: moisPayesListe,
        nombreMoisPayes: moisPayesListe.length,
        moisManquants,
        nombreMoisManquants: moisManquants.length,
        pourcentageProgression: Math.round((moisPayesListe.length / inscription.nombreMois) * 100),

        montantTotal,
        montantPaye,
        montantRestant,

        estAJour: moisManquants.length === 0,
        estEnRetard: moisManquants.length > 0 && moisPayesListe.length > 0,
        aucunPaiement: moisPayesListe.length === 0
      };
    });

    const totalEtudiants = inscriptions.length;
    const etudiantsAJour = etudiants.filter(e => e.estAJour).length;
    const etudiantsEnRetard = etudiants.filter(e => e.estEnRetard).length;
    const etudiantsSansPaiement = etudiants.filter(e => e.aucunPaiement).length;
    const totalRevenus = etudiants.reduce((sum, e) => sum + e.montantPaye, 0);

    res.json({
      success: true,
      formation: formation || 'Toutes les formations',
      cohorte: cohorte ? parseInt(cohorte) : 'Toutes les cohortes',

      resume: {
        totalEtudiants,
        etudiantsAJour,
        etudiantsEnRetard,
        etudiantsSansPaiement,
        totalRevenus,
        tauxPaiementGlobal: totalEtudiants > 0
          ? `${((etudiantsAJour / totalEtudiants) * 100).toFixed(1)}%`
          : '0%'
      },

      statsMois,

      etudiants
    });

  } catch (error) {
    console.error('❌ Erreur stats par mois:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
};

// ========================================
// 👤 DÉTAILS D'UN ÉTUDIANT SPÉCIFIQUE
//    C'est l'écran de l'assistante : tous les mois (7, puis 8 après
//    « Ajouter un mois ») avec leur statut et peutValider.
//
//    🆕 Mois 1 = mois SUIVANT le démarrage (démarrage Juillet → Mois 1 = Août).
//       Chaque ligne porte aussi moisCalendaire ("2026-08") et la date
//       exacte de validation (dateValidation).
// ========================================
export const getDetailsEtudiant = async (req, res) => {
  try {
    const { id } = req.params;

    const inscription = await prisma.inscription.findUnique({
      where: { id: parseInt(id) },
      include: {
        paiements: {
          orderBy: { mois: 'asc' }
        }
      }
    });

    if (!inscription) {
      return res.status(404).json({
        success: false,
        message: 'Étudiant introuvable'
      });
    }

    const paiementsParMois = [];
    const moisPayesListe = inscription.paiements
      .filter(p => p.status === 'VALIDE')
      .map(p => p.mois);

    for (let mois = 1; mois <= inscription.nombreMois; mois++) {
      const paiementMois = inscription.paiements.find(p => p.mois === mois);
      const moisCalendaire = cleMoisCalendaire(inscription, mois);

      paiementsParMois.push({
        mois,
        moisCalendaire,
        moisLabel: libelleMois(moisCalendaire, mois),
        statut: paiementMois
          ? paiementMois.status
          : 'NON_PAYE',
        peutValider: !paiementMois || paiementMois.status !== 'VALIDE',
        montant: paiementMois?.montant || inscription.mensualite,
        dateDemande: paiementMois?.createdAt || null,
        dateValidation: paiementMois?.dateValidation || null,
        paiementId: paiementMois?.id || null,
        urlRecu: paiementMois?.status === 'VALIDE'
          ? `${process.env.API_URL || 'http://localhost:8000'}/api/paiements/etudiant/recu/${paiementMois.id}`
          : null
      });
    }

    const montantTotal = inscription.mensualite * inscription.nombreMois;
    const montantPaye = inscription.paiements
      .filter(p => p.status === 'VALIDE')
      .reduce((sum, p) => sum + p.montant, 0);

    res.json({
      success: true,
      etudiant: {
        id: inscription.id,
        nom: inscription.nom,
        prenom: inscription.prenom,
        nomComplet: `${inscription.prenom} ${inscription.nom}`,
        email: inscription.email,
        telephone: inscription.telephone,
        formation: inscription.formation,
        cohorte: inscription.cohorte,
        estActif: inscription.estActif,
        dateInscription: inscription.createdAt,
        dateDemarrage: inscription.dateDemarrage,
        dateFinFormation: inscription.dateFinFormation
      },

      finances: {
        montantInscription: inscription.montantInscription || 0,
        mensualite: inscription.mensualite,
        nombreMois: inscription.nombreMois,
        montantTotal,
        montantPaye,
        montantRestant: montantTotal - montantPaye
      },

      progression: {
        moisPayes: moisPayesListe.length,
        moisEnAttente: inscription.paiements.filter(p => p.status === 'EN_ATTENTE').length,
        moisNonPayes: inscription.nombreMois - moisPayesListe.length,
        pourcentage: Math.round((moisPayesListe.length / inscription.nombreMois) * 100)
      },

      paiementsParMois,

      historiquePaiements: inscription.paiements.map(p => ({
        id: p.id,
        mois: p.mois,
        moisLabel: libellePaiement(p, inscription),
        montant: p.montant,
        status: p.status,
        dateDemande: p.createdAt,
        dateValidation: p.dateValidation,
        urlRecu: p.status === 'VALIDE'
          ? `${process.env.API_URL || 'http://localhost:8000'}/api/paiements/etudiant/recu/${p.id}`
          : null
      }))
    });

  } catch (error) {
    console.error('❌ Erreur détails étudiant:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des détails'
    });
  }
};

// ========================================
// 📋 LISTE DES FORMATIONS DISPONIBLES
// ========================================
export const getFormationsDisponibles = async (req, res) => {
  try {
    const formations = await prisma.inscription.findMany({
      where: {
        status: 'VALIDATED',
        estActif: true
      },
      select: {
        formation: true
      },
      distinct: ['formation']
    });

    const formationsListe = formations.map(f => f.formation).sort();

    res.json({
      success: true,
      formations: formationsListe
    });

  } catch (error) {
    console.error('❌ Erreur formations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
};

// ========================================
// 📋 LISTE DES COHORTES DISPONIBLES
// ========================================
export const getCohortesDisponibles = async (req, res) => {
  try {
    const { formation } = req.query;

    const where = {
      status: 'VALIDATED',
      estActif: true,
      cohorte: { not: null }
    };

    if (formation) {
      where.formation = formation;
    }

    const cohortes = await prisma.inscription.findMany({
      where,
      select: {
        cohorte: true
      },
      distinct: ['cohorte'],
      orderBy: {
        cohorte: 'asc'
      }
    });

    const cohortesListe = cohortes.map(c => c.cohorte);

    res.json({
      success: true,
      cohortes: cohortesListe
    });

  } catch (error) {
    console.error('❌ Erreur cohortes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
};