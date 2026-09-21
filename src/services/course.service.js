import prisma from '../config/database.js';
import uploadService from './upload.service.js';

class CourseService {

  async creerModule({ formation, titre, ordre, description, duree, objectifs }) {
    return prisma.courseModule.create({
      data: {
        formation,
        titre,
        ordre: parseInt(ordre),
        description: description || '',
        duree: duree || '',
        objectifs: Array.isArray(objectifs) ? objectifs : [],
      },
      include: { lessons: { orderBy: { ordre: 'asc' } } }
    });
  }

  async modifierModule(id, data) {
    return prisma.courseModule.update({
      where: { id },
      data: {
        ...(data.titre && { titre: data.titre }),
        ...(data.ordre !== undefined && { ordre: parseInt(data.ordre) }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.duree && { duree: data.duree }),
        ...(data.objectifs && { objectifs: Array.isArray(data.objectifs) ? data.objectifs : [] }),
      },
      include: { lessons: { orderBy: { ordre: 'asc' } } }
    });
  }

  // 🆕 Supprime une image du stockage Cloudinary à partir de son URL
  // (même principe que deleteVideo / deletePdf). Les URLs externes sont ignorées.
  async _supprimerImageCloudinary(url) {
    if (url && url.includes('res.cloudinary.com')) {
      await uploadService.deleteFile(url, 'image');
    }
  }

  // 🆕 Image du module (optionnelle) : fichier uploadé OU url externe
  async definirImageModule(id, { imageFile, imageUrl }) {
    const module = await prisma.courseModule.findUnique({ where: { id } });
    if (!module) throw new Error('Module introuvable');

    let nouvelleUrl = imageUrl;
    if (imageFile) {
      const uploaded = await uploadService.uploadImage(imageFile, `modules/${module.formation}`);
      nouvelleUrl = uploaded.url;
    }

    const moduleMaj = await prisma.courseModule.update({
      where: { id },
      data: { imageUrl: nouvelleUrl },
      include: { lessons: { orderBy: { ordre: 'asc' } } }
    });

    // L'ancienne image n'est supprimée qu'après la mise à jour réussie
    if (module.imageUrl && module.imageUrl !== nouvelleUrl) {
      await this._supprimerImageCloudinary(module.imageUrl);
    }

    return moduleMaj;
  }

  // 🆕 Retirer l'image (le front affiche alors un visuel par défaut)
  async supprimerImageModule(id) {
    const module = await prisma.courseModule.findUnique({ where: { id } });
    if (!module) throw new Error('Module introuvable');

    const moduleMaj = await prisma.courseModule.update({
      where: { id },
      data: { imageUrl: null },
      include: { lessons: { orderBy: { ordre: 'asc' } } }
    });

    await this._supprimerImageCloudinary(module.imageUrl);

    return moduleMaj;
  }

  async supprimerModule(id) {
    const module = await prisma.courseModule.findUnique({
      where: { id },
      select: { imageUrl: true }
    });

    const lecons = await prisma.courseLesson.findMany({
      where: { moduleId: id },
      select: { videoUrl: true, videoType: true, pdfUrl: true, pdfExoUrl: true }
    });

    await Promise.all([
      ...lecons.flatMap(l => [
        uploadService.deleteVideo(l.videoUrl),
        uploadService.deletePdf(l.pdfUrl),
        uploadService.deletePdf(l.pdfExoUrl),
      ]),
      // 🆕 supprime aussi l'image du module
      this._supprimerImageCloudinary(module?.imageUrl),
    ]);

    return prisma.courseModule.delete({ where: { id } });
  }

  async getModulesByFormation(formation) {
    return prisma.courseModule.findMany({
      where: { formation },
      orderBy: { ordre: 'asc' },
      include: { lessons: { orderBy: { ordre: 'asc' } } }
    });
  }

  async creerLecon({
    moduleId, titre, ordre, description, duree,
    videoUrl, consigneExo, requiresPreviousValidation,
    videoFile, pdfFile, pdfExoFile, formation,
  }) {

    let videoData = { type: null, url: null, publicId: null };
    if (videoFile) {
      videoData = await uploadService.uploadVideo(videoFile, formation);
    } else if (videoUrl && videoUrl.trim()) {
      videoData = await uploadService.uploadVideo(videoUrl.trim(), formation);
    }

    let pdfData = { url: null, publicId: null };
    if (pdfFile) {
      pdfData = await uploadService.uploadPdf(pdfFile, formation);
    }

    let pdfExoData = { url: null, publicId: null };
    if (pdfExoFile) {
      console.log('📝 Upload du PDF exo reçu dans le service');
      pdfExoData = await uploadService.uploadPdf(pdfExoFile, formation);
    }

    return prisma.courseLesson.create({
      data: {
        moduleId,
        titre,
        ordre: parseInt(ordre),
        description: description || '',
        duree: duree || '',
        videoUrl: videoData.url,
        videoType: videoData.type,
        videoPublicId: videoData.publicId,
        pdfUrl: pdfData.url,
        pdfPublicId: pdfData.publicId,
        pdfExoUrl: pdfExoData.url,
        pdfExoPublicId: pdfExoData.publicId,
        consigneExo: consigneExo || null,
        requiresPreviousValidation: requiresPreviousValidation !== false && requiresPreviousValidation !== 'false',
      },
      include: { module: true }
    });
  }

  async modifierLecon(id, data, videoFile, pdfFile, pdfExoFile) {
    const leconActuelle = await prisma.courseLesson.findUnique({
      where: { id },
      include: { module: true },
    });
    if (!leconActuelle) throw new Error('Leçon introuvable');

    const formation = leconActuelle.module?.formation || 'general';

    let videoUpdate = {};
    if (videoFile) {
      await uploadService.deleteVideo(leconActuelle.videoUrl);
      const videoData = await uploadService.uploadVideo(videoFile, formation);
      videoUpdate = {
        videoUrl: videoData.url,
        videoType: videoData.type,
        videoPublicId: videoData.publicId,
      };
    } else if (data.videoUrl && data.videoUrl.trim()) {
      await uploadService.deleteVideo(leconActuelle.videoUrl);
      const videoData = await uploadService.uploadVideo(data.videoUrl.trim(), formation);
      videoUpdate = {
        videoUrl: videoData.url,
        videoType: videoData.type,
        videoPublicId: videoData.publicId,
      };
    } else if (data.videoUrl === '') {
      await uploadService.deleteVideo(leconActuelle.videoUrl);
      videoUpdate = { videoUrl: null, videoType: null, videoPublicId: null };
    }

    let pdfUpdate = {};
    if (pdfFile) {
      await uploadService.deletePdf(leconActuelle.pdfUrl);
      const pdfData = await uploadService.uploadPdf(pdfFile, formation);
      pdfUpdate = { pdfUrl: pdfData.url, pdfPublicId: pdfData.publicId };
    } else if (data.pdfUrl === '') {
      await uploadService.deletePdf(leconActuelle.pdfUrl);
      pdfUpdate = { pdfUrl: null, pdfPublicId: null };
    }

    let pdfExoUpdate = {};
    if (pdfExoFile) {
      await uploadService.deletePdf(leconActuelle.pdfExoUrl);
      const pdfExoData = await uploadService.uploadPdf(pdfExoFile, formation);
      pdfExoUpdate = { pdfExoUrl: pdfExoData.url, pdfExoPublicId: pdfExoData.publicId };
    } else if (data.pdfExoUrl === '') {
      await uploadService.deletePdf(leconActuelle.pdfExoUrl);
      pdfExoUpdate = { pdfExoUrl: null, pdfExoPublicId: null };
    }

    return prisma.courseLesson.update({
      where: { id },
      data: {
        ...(data.titre && { titre: data.titre }),
        ...(data.ordre !== undefined && { ordre: parseInt(data.ordre) }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.duree && { duree: data.duree }),
        ...(data.consigneExo !== undefined && { consigneExo: data.consigneExo || null }),
        ...(data.requiresPreviousValidation !== undefined && {
          requiresPreviousValidation: data.requiresPreviousValidation !== false && data.requiresPreviousValidation !== 'false',
        }),
        ...videoUpdate,
        ...pdfUpdate,
        ...pdfExoUpdate,
      },
      include: { module: true }
    });
  }

  async supprimerLecon(id) {
    const lecon = await prisma.courseLesson.findUnique({ where: { id } });
    if (!lecon) throw new Error('Leçon introuvable');

    await Promise.all([
      uploadService.deleteVideo(lecon.videoUrl),
      uploadService.deletePdf(lecon.pdfUrl),
      uploadService.deletePdf(lecon.pdfExoUrl),
    ]);

    return prisma.courseLesson.delete({ where: { id } });
  }

  async soumettreLessonSubmission({ lessonId, inscriptionId, link, uploadFile, formation }) {
    if (!link && !uploadFile) {
      throw new Error('Veuillez fournir un lien ou un fichier.');
    }

    let fileData = { url: null, publicId: null, name: null };
    if (uploadFile) {
      const uploaded = await uploadService.uploadPdf(uploadFile, formation);
      fileData = {
        url: uploaded.url,
        publicId: uploaded.publicId,
        name: uploadFile.originalname || uploadFile.name || null,
      };
    }

    return prisma.lessonSubmission.upsert({
      where: {
        lessonId_inscriptionId: { lessonId, inscriptionId },
      },
      create: {
        lessonId,
        inscriptionId,
        link: link || null,
        fileUrl: fileData.url,
        filePublicId: fileData.publicId,
        fileName: fileData.name,
        status: 'PENDING',
      },
      update: {
        link: link || null,
        fileUrl: fileData.url,
        filePublicId: fileData.publicId,
        fileName: fileData.name,
        status: 'PENDING',
        feedback: null,
        note: null,
      },
    });
  }

  async corrigerLessonSubmission(submissionId, { note, feedback, status }) {
    return prisma.lessonSubmission.update({
      where: { id: submissionId },
      data: {
        ...(note !== undefined && { note: parseInt(note) }),
        ...(feedback !== undefined && { feedback }),
        ...(status && { status }),
      },
      include: { lesson: true, inscription: true },
    });
  }

  async getCoursAvecProgression(formation, inscriptionId) {
    const modules = await prisma.courseModule.findMany({
      where: { formation },
      orderBy: { ordre: 'asc' },
      include: {
        lessons: {
          orderBy: { ordre: 'asc' },
          include: {
            submissions: {
              // 🔒 Prisma ignore un filtre "undefined" → il renverrait les soumissions
              // de TOUS les étudiants. Sans inscriptionId, on ne renvoie aucune soumission.
              where: { inscriptionId: inscriptionId ?? -1 },
              select: {
                id: true, status: true, note: true,
                feedback: true, link: true,
                fileUrl: true, fileName: true, createdAt: true,
              }
            }
          }
        }
      }
    });

    return modules.map((module, moduleIndex) => ({
      ...module,
      lessons: module.lessons.map((lecon, leconIndex) => {
        const submission = lecon.submissions[0] || null;
        const accessible = this._isAccessible(modules, moduleIndex, leconIndex);

        return {
          ...lecon,
          submissions: undefined,
          submission,
          accessible,
          status: submission?.status || (accessible ? 'ACCESSIBLE' : 'LOCKED'),
        };
      })
    }));
  }

  _isAccessible(modules, moduleIndex, leconIndex) {
    if (moduleIndex === 0 && leconIndex === 0) return true;

    let prevLecon;
    if (leconIndex > 0) {
      prevLecon = modules[moduleIndex].lessons[leconIndex - 1];
    } else if (moduleIndex > 0) {
      const prevModule = modules[moduleIndex - 1];
      prevLecon = prevModule.lessons[prevModule.lessons.length - 1];
    }

    if (!prevLecon) return true;

    const currentLecon = modules[moduleIndex].lessons[leconIndex];
    if (!currentLecon.requiresPreviousValidation) return true;

    const prevSubmission = prevLecon.submissions?.[0];
    return prevSubmission?.status === 'APPROVED';
  }

  async getAllCours() {
    return prisma.courseModule.findMany({
      orderBy: [{ formation: 'asc' }, { ordre: 'asc' }],
      include: {
        lessons: {
          orderBy: { ordre: 'asc' },
          include: {
            _count: { select: { submissions: true } }
          }
        }
      }
    });
  }
}

export default new CourseService();