import prisma from '../config/database.js';
import submissionNotificationService from '../services/submission-notification.service.js';
import partAccessService from '../services/part-access.service.js';

class SubmissionController {
  /**
   * 📤 Étudiant soumet un TD (PARTIE PAR PARTIE)
   */
  async soumettreTD(req, res) {
    try {
      const { partId, lessonId, moduleId, link, partTitle, lessonTitle } = req.body;
      const userEmail = req.user.email;

      console.log('📤 Soumission TD:', { partId, lessonId, moduleId, userEmail });

      if (!partId || !lessonId || !moduleId || !link || !partTitle) {
        return res.status(400).json({
          success: false,
          message: 'Tous les champs sont obligatoires (partId, lessonId, moduleId, link, partTitle)'
        });
      }

      const inscription = await prisma.inscription.findFirst({
        where: { email: userEmail }
      });

      if (!inscription) {
        console.error('❌ Aucune inscription pour email:', userEmail);
        return res.status(404).json({ success: false, message: 'Inscription non trouvée' });
      }
      console.log('✅ Inscription:', inscription.id);

      const isAccessible = await partAccessService.isPartAccessible(
        partId,
        inscription.id,
        inscription.formation
      );

      if (!isAccessible) {
        return res.status(403).json({
          success: false,
          message: 'Vous devez valider la partie précédente avant de soumettre celle-ci'
        });
      }

      let assignment = await prisma.assignment.findFirst({
        where: { partId, formation: inscription.formation }
      });

      if (!assignment) {
        console.log('🆕 Création assignment pour la partie:', partId);
        assignment = await prisma.assignment.create({
          data: {
            partId,
            lessonId,
            moduleId,
            formation: inscription.formation,
            instruction: partTitle
          }
        });
      }

      console.log('✅ Assignment:', assignment.id);

      const existante = await prisma.submission.findFirst({
        where: { assignmentId: assignment.id, inscriptionId: inscription.id }
      });

      let submission;

      if (existante) {
        if (existante.status === 'APPROVED') {
          return res.status(400).json({ success: false, message: 'Cette partie a déjà été validée' });
        }
        if (existante.status === 'PENDING') {
          return res.status(400).json({
            success: false,
            message: 'Votre devoir pour cette partie est en cours de correction'
          });
        }
        if (existante.status === 'REJECTED') {
          console.log('🔄 Mise à jour de la soumission rejetée:', existante.id);
          submission = await prisma.submission.update({
            where: { id: existante.id },
            data: { link, status: 'PENDING', feedback: null, updatedAt: new Date() },
            include: { assignment: true, inscription: true }
          });
        }
      } else {
        submission = await prisma.submission.create({
          data: {
            assignmentId: assignment.id,
            inscriptionId: inscription.id,
            link,
            status: 'PENDING'
          },
          include: { assignment: true, inscription: true }
        });
      }

      console.log('✅ Soumission créée:', submission.id);

      Promise.all([
        submissionNotificationService.confirmerSoumission(
          inscription,
          `${lessonTitle} - ${partTitle}`
        ),
        submissionNotificationService.notifierAdminNouveauTD(
          inscription,
          `${lessonTitle} - ${partTitle}`,
          link
        )
      ]).catch(error => console.error('❌ Erreur envoi emails:', error));

      res.status(201).json({
        success: true,
        message: 'Devoir soumis avec succès !',
        submission: {
          id: submission.id,
          partId: assignment.partId,
          lessonId: assignment.lessonId,
          moduleId: assignment.moduleId,
          link: submission.link,
          status: submission.status,
          createdAt: submission.createdAt
        }
      });

    } catch (error) {
      console.error('❌ Erreur soumission TD:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la soumission', error: error.message });
    }
  }

  /**
   * 📤 Étudiant soumet une leçon complète
   */
  async soumettreLecon(req, res) {
    try {
      const { lessonId, link } = req.body;
      const userEmail = req.user.email;

      if (!lessonId || !link) {
        return res.status(400).json({ success: false, message: 'lessonId et link sont obligatoires' });
      }

      const inscription = await prisma.inscription.findFirst({
        where: { email: userEmail }
      });

      if (!inscription) {
        return res.status(404).json({ success: false, message: 'Inscription non trouvée' });
      }

      const existante = await prisma.lessonSubmission.findFirst({
        where: { lessonId, inscriptionId: inscription.id }
      });

      let submission;

      if (existante) {
        if (existante.status === 'APPROVED') {
          return res.status(400).json({ success: false, message: 'Cette leçon a déjà été validée' });
        }
        if (existante.status === 'PENDING') {
          return res.status(400).json({
            success: false,
            message: 'Votre devoir est déjà en cours de correction'
          });
        }
        submission = await prisma.lessonSubmission.update({
          where: { id: existante.id },
          data: { link, status: 'PENDING', feedback: null }
        });
      } else {
        submission = await prisma.lessonSubmission.create({
          data: { lessonId, inscriptionId: inscription.id, link, status: 'PENDING' }
        });
      }

      res.status(201).json({ success: true, message: 'Devoir soumis avec succès !', submission });

    } catch (error) {
      console.error('❌ soumettreLecon:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la soumission', error: error.message });
    }
  }

  /**
   * 📋 Soumissions TD d'un étudiant (PAR PARTIE)
   */
  async getMesSoumissions(req, res) {
    try {
      const userEmail = req.user.email;

      const inscription = await prisma.inscription.findFirst({
        where: { email: userEmail }
      });

      if (!inscription) {
        return res.status(404).json({ success: false, message: 'Inscription non trouvée' });
      }

      const submissions = await prisma.submission.findMany({
        where: { inscriptionId: inscription.id },
        include: { assignment: true },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = submissions.map(sub => ({
        id: sub.id,
        partId: sub.assignment.partId,
        lessonId: sub.assignment.lessonId,
        moduleId: sub.assignment.moduleId,
        partTitle: sub.assignment.instruction,
        link: sub.link,
        status: sub.status,
        coachFeedback: sub.feedback,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt
      }));

      res.json({ success: true, count: formatted.length, submissions: formatted });

    } catch (error) {
      console.error('❌ Erreur récupération soumissions:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
    }
  }

  /**
   * 📋 Soumissions leçons d'un étudiant
   */
  async getMesLessonSoumissions(req, res) {
    try {
      const userEmail = req.user.email;

      const inscription = await prisma.inscription.findFirst({
        where: { email: userEmail }
      });

      if (!inscription) {
        return res.status(404).json({ success: false, message: 'Inscription non trouvée' });
      }

      const submissions = await prisma.lessonSubmission.findMany({
        where: { inscriptionId: inscription.id },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ success: true, count: submissions.length, submissions });

    } catch (error) {
      console.error('❌ getMesLessonSoumissions:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
    }
  }

  /**
   * 📋 Toutes les soumissions TD (admin)
   */
/**
   * 📋 Toutes les soumissions TD (admin)
   */
async getToutesSoumissions(req, res) {
  try {
    const { status, formation, cohorte } = req.query;
    console.log('🔍 getToutesSoumissions appelée avec:', { status, formation, cohorte });

    const where = {};
    if (status) where.status = status;
    console.log('🔍 Filtre Prisma where:', where);

    const submissions = await prisma.submission.findMany({
      where,
      include: {
        inscription: {
          select: { id: true, nom: true, prenom: true, email: true, formation: true, cohorte: true }
        },
        assignment: {
          select: { partId: true, lessonId: true, moduleId: true, instruction: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📦 Nombre de soumissions trouvées en base: ${submissions.length}`);

    if (submissions.length > 0) {
      console.log('📦 Première soumission brute:', JSON.stringify(submissions[0], null, 2));
    } else {
      console.log('⚠️  Aucune soumission en base — la table Submission est peut-être vide');
    }

    let filtered = submissions;

    if (formation) {
      filtered = filtered.filter(s => {
        const match = s.inscription?.formation?.toLowerCase().includes(formation.toLowerCase());
        console.log(`  → filtre formation sur ${s.id}: inscription=${JSON.stringify(s.inscription)}, match=${match}`);
        return match;
      });
      console.log(`📦 Après filtre formation="${formation}": ${filtered.length} résultats`);
    }

    if (cohorte) {
      filtered = filtered.filter(s => {
        const match = s.inscription?.cohorte === parseInt(cohorte);
        return match;
      });
      console.log(`📦 Après filtre cohorte="${cohorte}": ${filtered.length} résultats`);
    }

    const formatted = filtered.map(sub => {
      if (!sub.inscription) {
        console.warn(`⚠️  Soumission ${sub.id} n'a pas d'inscription associée (inscriptionId=${sub.inscriptionId})`);
      }
      if (!sub.assignment) {
        console.warn(`⚠️  Soumission ${sub.id} n'a pas d'assignment associé (assignmentId=${sub.assignmentId})`);
      }
      return {
        id: sub.id,
        partId: sub.assignment?.partId ?? null,
        lessonId: sub.assignment?.lessonId ?? null,
        moduleId: sub.assignment?.moduleId ?? null,
        partTitle: sub.assignment?.instruction ?? null,
        lessonTitle: sub.assignment?.instruction ?? null,
        link: sub.link,
        status: sub.status,
        coachFeedback: sub.feedback,
        createdAt: sub.createdAt,
        student: sub.inscription ?? null
      };
    });

    console.log(`✅ Réponse envoyée: ${formatted.length} soumissions formatées`);
    if (formatted.length > 0) {
      console.log('✅ Première soumission formatée:', JSON.stringify(formatted[0], null, 2));
    }

    res.json({ success: true, count: formatted.length, submissions: formatted });

  } catch (error) {
    console.error('❌ Erreur récupération soumissions:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
  }
}
  /**
   * 📋 Toutes les soumissions leçons (admin)
   *//**
   * 📋 Toutes les soumissions leçons (admin)
   */
  async getToutesLessonSoumissions(req, res) {
    try {
      const { status, formation, moduleId, cohorte } = req.query;

      const where = {};
      if (status) where.status = status;

      const submissions = await prisma.lessonSubmission.findMany({
        where,
        include: {
          inscription: {
            select: { id: true, nom: true, prenom: true, email: true, formation: true, cohorte: true }
          },
          // 🆕 Jointure vers la leçon puis le module pour récupérer les titres
          lesson: {
            select: {
              id: true,
              titre: true,
              ordre: true,
              module: {
                select: { id: true, titre: true, formation: true, ordre: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      let filtered = submissions;

      // Formation : on privilégie celle du module (source de vérité du contenu),
      // avec repli sur celle de l'inscription si la leçon a été supprimée.
      if (formation) {
        filtered = filtered.filter(s => {
          const f = s.lesson?.module?.formation ?? s.inscription?.formation ?? '';
          return f.toLowerCase().includes(formation.toLowerCase());
        });
      }

      if (moduleId) {
        filtered = filtered.filter(s => s.lesson?.module?.id === moduleId);
      }

      if (cohorte) {
        filtered = filtered.filter(s => s.inscription?.cohorte === parseInt(cohorte));
      }

      const formatted = filtered.map(sub => ({
        id: sub.id,
        lessonId: sub.lessonId,
        lessonTitle: sub.lesson?.titre ?? null,
        moduleId: sub.lesson?.module?.id ?? null,
        moduleTitle: sub.lesson?.module?.titre ?? null,
        formation: sub.lesson?.module?.formation ?? sub.inscription?.formation ?? null,
        link: sub.link,
        fileUrl: sub.fileUrl,
        fileName: sub.fileName,
        note: sub.note,
        feedback: sub.feedback,
        status: sub.status,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
        inscription: sub.inscription
      }));

      res.json({ success: true, count: formatted.length, submissions: formatted });

    } catch (error) {
      console.error('❌ getToutesLessonSoumissions:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération' });
    }
  }

  /**
   * ✅ Admin valide un TD (partie)
   */
  async validerTD(req, res) {
    try {
      const { id } = req.params;
      const { partTitle } = req.body;

      const submission = await prisma.submission.update({
        where: { id: parseInt(id) },
        data: { status: 'APPROVED', updatedAt: new Date() },
        include: { inscription: true, assignment: true }
      });

      submissionNotificationService
        .notifierEtudiantValidation(submission.inscription, partTitle || submission.assignment.instruction)
        .catch(err => console.error('❌ Erreur envoi email validation:', err));

      res.json({
        success: true,
        message: 'Partie validée avec succès',
        submission: { id: submission.id, partId: submission.assignment.partId, status: submission.status }
      });

    } catch (error) {
      console.error('❌ Erreur validation TD:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la validation' });
    }
  }

  /**
   * ✅ Admin valide une leçon
   */
  async validerLessonTD(req, res) {
    try {
      const { id } = req.params;

      const submission = await prisma.lessonSubmission.update({
        where: { id: parseInt(id) },
        data: { status: 'APPROVED', updatedAt: new Date() },
        include: { inscription: true }
      });

      submissionNotificationService
        .notifierEtudiantValidation(submission.inscription, `Leçon ${submission.lessonId}`)
        .catch(err => console.error('❌ Email validation leçon:', err));

      res.json({ success: true, message: 'Leçon validée avec succès', submission });

    } catch (error) {
      console.error('❌ validerLessonTD:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la validation' });
    }
  }

  /**
   * ❌ Admin rejette un TD (partie)
   */
  async rejeterTD(req, res) {
    try {
      const { id } = req.params;
      const { feedback, partTitle } = req.body;

      if (!feedback || feedback.trim() === '') {
        return res.status(400).json({ success: false, message: 'Le feedback est obligatoire' });
      }

      const submission = await prisma.submission.update({
        where: { id: parseInt(id) },
        data: { status: 'REJECTED', feedback, updatedAt: new Date() },
        include: { inscription: true, assignment: true }
      });

      submissionNotificationService
        .notifierEtudiantRejet(
          submission.inscription,
          partTitle || submission.assignment.instruction,
          feedback
        )
        .catch(err => console.error('❌ Erreur envoi email rejet:', err));

      res.json({
        success: true,
        message: 'Partie rejetée avec feedback',
        submission: {
          id: submission.id,
          partId: submission.assignment.partId,
          status: submission.status,
          feedback: submission.feedback
        }
      });

    } catch (error) {
      console.error('❌ Erreur rejet TD:', error);
      res.status(500).json({ success: false, message: 'Erreur lors du rejet' });
    }
  }

  /**
   * ❌ Admin rejette une leçon
   */
  async rejeterLessonTD(req, res) {
    try {
      const { id } = req.params;
      const { feedback } = req.body;

      if (!feedback || feedback.trim() === '') {
        return res.status(400).json({ success: false, message: 'Le feedback est obligatoire' });
      }

      const submission = await prisma.lessonSubmission.update({
        where: { id: parseInt(id) },
        data: { status: 'REJECTED', feedback, updatedAt: new Date() },
        include: { inscription: true }
      });

      submissionNotificationService
        .notifierEtudiantRejet(submission.inscription, `Leçon ${submission.lessonId}`, feedback)
        .catch(err => console.error('❌ Email rejet leçon:', err));

      res.json({
        success: true,
        message: 'Leçon rejetée avec feedback',
        submission: {
          id: submission.id,
          lessonId: submission.lessonId,
          status: submission.status,
          feedback: submission.feedback
        }
      });

    } catch (error) {
      console.error('❌ rejeterLessonTD:', error);
      res.status(500).json({ success: false, message: 'Erreur lors du rejet' });
    }
  }

  /**
   * 📊 Statistiques soumissions TD
   */
  async getStatistiquesSoumissions(req, res) {
    try {
      const { formation, cohorte } = req.query;

      const whereInscription = {};
      if (formation) whereInscription.formation = { contains: formation, mode: 'insensitive' };
      if (cohorte) whereInscription.cohorte = parseInt(cohorte);

      const [total, enAttente, validees, rejetees] = await Promise.all([
        prisma.submission.count({ where: { inscription: whereInscription } }),
        prisma.submission.count({ where: { status: 'PENDING', inscription: whereInscription } }),
        prisma.submission.count({ where: { status: 'APPROVED', inscription: whereInscription } }),
        prisma.submission.count({ where: { status: 'REJECTED', inscription: whereInscription } })
      ]);

      res.json({
        success: true,
        stats: {
          total,
          enAttente,
          validees,
          rejetees,
          tauxValidation: total > 0 ? Math.round((validees / total) * 100) : 0
        }
      });

    } catch (error) {
      console.error('❌ Erreur statistiques:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des statistiques' });
    }
  }
}

export default new SubmissionController();