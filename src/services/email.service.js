import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

// ✅ Configuration SMTP
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false,
    ciphers: 'SSLv3'
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
  connectionTimeout: 60000,
  greetingTimeout: 60000,
  socketTimeout: 60000,
  debug: false,
  logger: false
});

transporter.verify(function (error, success) {
  if (error) {
    console.error('❌ Erreur connexion SMTP:', error);
  } else {
    console.log('✅ Serveur SMTP prêt');
  }
});

// ============================================================
// 🏷️  MODES D'INSCRIPTION
//    EN_LIGNE / PRESENTIEL → paiement (mensuel ou unique), reçu + guide
//    PONCTUEL              → petits montants libres, reçu, pas de guide
//    GRATUIT               → aucun paiement, ni reçu ni guide
// ============================================================
const LIBELLE_MODE = {
  EN_LIGNE: 'En ligne',
  PRESENTIEL: 'Présentiel',
  PONCTUEL: 'Ponctuel',
  GRATUIT: 'Gratuit'
};

const PHRASE_MODE = {
  EN_LIGNE: 'suivie en ligne',
  PRESENTIEL: 'suivie en présentiel'
};

const dateDuJour = () =>
  new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// ============================================================
// 📄 PDF REÇU D'INSCRIPTION → Buffer (compatible Vercel)
//    mode PONCTUEL → libellés adaptés (paiement, pas "frais d'inscription")
// ============================================================
const genererRecuInscriptionBuffer = ({
  nomComplet,
  email,
  telephone,
  formation,
  montantInscription,
  inscriptionId,
  mode,
  dateInscription = new Date()
}) => {
  return new Promise((resolve, reject) => {
    try {
      const estPonctuel = mode === 'PONCTUEL';
      const libelleMode = LIBELLE_MODE[mode];

      const doc = new PDFDocument({ size: 'A4', margin: 50, compress: true });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // En-tête
      doc.fontSize(26)
        .fillColor('#27446e')
        .text('TELLYTECH', 150, 50, { align: 'left' })
        .fontSize(10)
        .fillColor('#673f21')
        .text('École de Formation Professionnelle', 150, 80, { align: 'left' })
        .text('Dakar, Sénégal', 150, 95, { align: 'left' })
        .text('Tél: +221 78 111 87 69 | Email: technologytelly@gmail.com', 50, 110, { align: 'center' });

      doc.moveTo(50, 130).lineTo(545, 130).strokeColor('#27446e').stroke();

      doc.fontSize(20)
        .fillColor('#27446e')
        .text(
          estPonctuel ? 'REÇU DE PAIEMENT' : "REÇU DE PAIEMENT D'INSCRIPTION",
          50, 150, { align: 'center' }
        );

      doc.fontSize(10)
        .fillColor('#673f21')
        .text(`N° ${inscriptionId}`, 50, 190)
        .text(`Date: ${dateInscription.toLocaleDateString('fr-FR')}`, 400, 190);

      let yPos = 230;
      doc.fontSize(14).fillColor('#27446e').text("INFORMATIONS DE L'ÉTUDIANT", 50, yPos);

      yPos += 25;
      doc.fontSize(11).fillColor('#000000')
        .text('Nom complet:', 50, yPos)
        .text(nomComplet, 200, yPos);

      yPos += 20;
      doc.text('Email:', 50, yPos).text(email, 200, yPos);

      yPos += 20;
      doc.text('Téléphone:', 50, yPos).text(telephone, 200, yPos);

      yPos += 40;
      doc.fontSize(14).fillColor('#27446e').text('FORMATION CHOISIE', 50, yPos);

      yPos += 25;
      doc.fontSize(11).fillColor('#000000')
        .text('Formation:', 50, yPos)
        .text(formation, 200, yPos);

      // Ligne "Mode" (uniquement si le mode est connu)
      if (libelleMode) {
        yPos += 20;
        doc.text('Mode:', 50, yPos).text(libelleMode, 200, yPos);
        yPos += 30;
      } else {
        yPos += 50;
      }

      doc.rect(50, yPos, 495, 30).fillAndStroke('#f3f4f6', '#27446e');
      doc.fillColor('#27446e').fontSize(11)
        .text('DESCRIPTION', 60, yPos + 10)
        .text('MONTANT', 450, yPos + 10);

      yPos += 30;
      doc.rect(50, yPos, 495, 40).stroke('#e5e7eb');
      doc.fillColor('#000000')
        .text(
          estPonctuel ? `Paiement - ${formation}` : `Frais d'inscription - ${formation}`,
          60, yPos + 12
        )
        .fontSize(12).fillColor('#673f21')
        .text(`${montantInscription.toLocaleString('fr-FR')} FCFA`, 420, yPos + 12);

      yPos += 40;
      doc.rect(50, yPos, 495, 35).fillAndStroke('#e8f0f7', '#27446e');
      doc.fontSize(14).fillColor('#27446e')
        .text('TOTAL PAYÉ', 60, yPos + 10)
        .fontSize(16).fillColor('#673f21')
        .text(`${montantInscription.toLocaleString('fr-FR')} FCFA`, 400, yPos + 10);

      yPos += 60;
      doc.fontSize(12).fillColor('#27446e')
        .text('PAIEMENT CONFIRMÉ', 50, yPos, { align: 'center' });

      doc.fontSize(10).fillColor('#000000').text('Jean Mamady Cissé', 80, 620);
      doc.fontSize(9).fillColor('#673f21').text('Manager', 80, 635);

      doc.fontSize(9).fillColor('#999999')
        .text(
          estPonctuel
            ? 'Ce reçu atteste du paiement effectué.'
            : "Ce reçu atteste du paiement des frais d'inscription.",
          50, 720, { align: 'center' }
        )
        .text('Conservez ce document précieusement.', { align: 'center' })
        .text('technologytelly@gmail.com | +221 78 111 87 69', { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ============================================================
// 📘 PDF GUIDE BIENVENUE → Buffer (compatible Vercel)
//    mensualite est OPTIONNEL (null pour paiement unique)
//    Uniquement pour les modes EN_LIGNE / PRESENTIEL
// ============================================================
const genererGuideBienvenueBuffer = ({
  nomComplet,
  formation,
  nombreMois,
  mensualite,      // null ou 0 = paiement unique (Bureautique, CM, Audiovisuel…)
  inscriptionId
}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, compress: true });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const estPaiementUnique = !mensualite || mensualite === 0;

      doc.fontSize(24).fillColor('#27446e')
        .text('GUIDE DE BIENVENUE', 50, 40, { align: 'center' });

      doc.fontSize(14).fillColor('#673f21')
        .text(`Formation: ${formation}`, 50, 75, { align: 'center' });

      doc.moveTo(50, 100).lineTo(545, 100).strokeColor('#27446e').stroke();

      let yPos = 120;
      doc.fontSize(12).fillColor('#27446e').text(`Cher(e) ${nomComplet},`, 50, yPos);

      yPos += 25;
      doc.fontSize(10).fillColor('#000000')
        .text(`Félicitations ! Vous êtes inscrit(e) à la formation "${formation}".`, 50, yPos, { width: 495 });

      yPos += 40;
      doc.fontSize(12).fillColor('#27446e').text('VOTRE FORMATION', 50, yPos);
      yPos += 20;

      // ── Durée (toujours affichée) ─────────────────────────────────────
      doc.fontSize(10).fillColor('#000000')
        .text(`• Durée : ${nombreMois} mois`, 60, yPos);

      if (estPaiementUnique) {
        // Paiement unique → pas de mensualité
        doc.text('• Paiement unique — formation réglée intégralement', 60, yPos + 15);
        yPos += 40;
      } else {
        // Paiement mensuel → afficher mensualité + total
        doc
          .text(`• Mensualité : ${mensualite.toLocaleString('fr-FR')} FCFA`, 60, yPos + 15)
          .text(`• Total : ${(nombreMois * mensualite).toLocaleString('fr-FR')} FCFA`, 60, yPos + 30);
        yPos += 60;
      }

      // ── Règles de paiement ────────────────────────────────────────────
      doc.fontSize(12).fillColor('#27446e').text('RÈGLES DE PAIEMENT', 50, yPos);
      yPos += 20;

      if (estPaiementUnique) {
        doc.fontSize(10).fillColor('#000000')
          .text('• Paiement unique effectué à l\'inscription', 60, yPos, { width: 485 })
          .text('• Reçu PDF joint à cet email', 60, yPos + 15, { width: 485 })
          .text('• Aucune mensualité à régler', 60, yPos + 30, { width: 485 });
      } else {
        doc.fontSize(10).fillColor('#000000')
          .text('• Paiements avant le 10 de chaque mois via votre espace étudiant', 60, yPos, { width: 485 })
          .text('• Reçu PDF après chaque validation', 60, yPos + 15, { width: 485 })
          .text('• Retard = suspension temporaire', 60, yPos + 30, { width: 485 });
      }

      yPos += 60;
      doc.fontSize(12).fillColor('#27446e').text('CERTIFICATION', 50, yPos);
      yPos += 20;
      doc.fontSize(10).fillColor('#000000')
        .text(
          estPaiementUnique
            ? '• Paiement unique validé'
            : `• Payer les ${nombreMois} mois intégralement`,
          60, yPos
        )
        .text('• Valider tous les modules', 60, yPos + 15)
        .text('• Réussir le projet final', 60, yPos + 30)
        .text('• Assiduité 80% minimum', 60, yPos + 45);

      yPos += 75;
      doc.fontSize(12).fillColor('#27446e').text('CONTACT', 50, yPos);
      yPos += 20;
      doc.fontSize(10).fillColor('#000000')
        .text('Email: technologytelly@gmail.com', 60, yPos)
        .text('Tél: +221 78 111 87 69', 60, yPos + 15);

      yPos += 50;
      doc.fontSize(10).fillColor('#27446e').text('Jean Mamady Cissé', 60, yPos);
      doc.fontSize(9).fillColor('#673f21').text('Manager - TellyTech', 60, yPos + 15);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ============================================================
// 📧 EMAIL CONFIRMATION D'INSCRIPTION (envoyé immédiatement)
// ============================================================
export const envoyerEmailInscription = async ({
  nomComplet,
  email,
  formation,
  code,
  inscriptionId
}) => {
  try {
    console.log(`📤 Envoi email inscription à ${email}...`);

    const mailOptions = {
      from: `"TellyTech Formation" <${process.env.EMAIL_USER}>`,
      to: email,
      replyTo: process.env.EMAIL_USER,
      subject: `Réception de votre demande d'inscription - TellyTech Formation`,
      html: `
        <div style="font-family: 'Georgia', 'Times New Roman', serif; max-width: 650px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb;">
          <div style="background: #27446e; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: normal; letter-spacing: 2px;">TELLYTECH</h1>
            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 13px; opacity: 0.9;">École de Formation Professionnelle</p>
          </div>
          <div style="padding: 50px 40px; line-height: 1.8; color: #1f2937;">
            <p style="margin: 0 0 25px 0; font-size: 15px;">
              Dakar, le ${dateDuJour()}
            </p>
            <p style="margin: 0 0 25px 0; font-size: 15px;">
              Madame, Monsieur <strong>${nomComplet}</strong>,
            </p>
            <p style="margin: 0 0 20px 0; font-size: 15px; text-align: justify;">
              Nous accusons bonne réception de votre demande d'inscription à notre formation
              <strong>"${formation}"</strong> et vous en remercions vivement.
            </p>
            <p style="margin: 0 0 20px 0; font-size: 15px; text-align: justify;">
              Votre dossier est actuellement en cours d'examen par notre équipe pédagogique.
              Un membre de notre service vous contactera sous peu par téléphone afin de confirmer
              les modalités de votre inscription et de répondre à l'ensemble de vos questions.
            </p>
            <div style="background: #e8f0f7; padding: 25px; margin: 30px 0; border-left: 4px solid #27446e;">
              <p style="margin: 0 0 15px 0; font-size: 15px; color: #27446e; font-weight: bold;">
                À propos de notre plateforme de formation
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.7; text-align: justify;">
                TellyTech met à votre disposition une plateforme d'apprentissage moderne et intuitive,
                proposant des cours détaillés, des exercices pratiques et un suivi personnalisé.
                Vous aurez accès à l'ensemble des ressources pédagogiques dès la validation de votre inscription.
              </p>
            </div>
            <p style="margin: 0 0 20px 0; font-size: 15px; text-align: justify;">
              Nous vous invitons à rester attentif à vos emails ainsi qu'à votre téléphone dans les prochains jours.
            </p>
            <p style="margin: 30px 0 10px 0; font-size: 15px;">
              Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.
            </p>
            <div style="margin: 40px 0 0 0;">
              <p style="margin: 0 0 5px 0; font-size: 15px; font-weight: bold; color: #27446e;">Jean Mamady Cissé</p>
              <p style="margin: 0; font-size: 14px; color: #673f21;">Manager - TellyTech Formation</p>
            </div>
          </div>
          <div style="background: #f9fafb; padding: 25px 40px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px 0; color: #27446e; font-size: 14px; font-weight: bold;">Contact</p>
            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
              Email : technologytelly@gmail.com<br>
              Téléphone : +221 78 111 87 69<br>
              Adresse : Dakar, Sénégal
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email inscription envoyé à ${email} - MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('❌ Erreur email inscription étudiant:', error);
    throw error;
  }
};

// ============================================================
// 📧 EMAIL ADMIN (nouvelle inscription)
// ============================================================
export const envoyerEmailAdmin = async ({
  nomComplet,
  email,
  telephone,
  formation,
  code,
  inscriptionId
}) => {
  try {
    console.log(`📤 Envoi email admin pour inscription ${inscriptionId}...`);

    const mailOptions = {
      from: `"TellyTech Formation" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      replyTo: email,
      subject: `Nouvelle inscription - ${formation}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #27446e;">Nouvelle demande d'inscription</h2>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Nom complet:</strong> ${nomComplet}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Téléphone:</strong> ${telephone}</p>
            <p><strong>Formation:</strong> ${formation}</p>
            <hr style="border: 1px solid #d1d5db; margin: 15px 0;">
            <p style="font-size: 18px;"><strong>CODE:</strong>
              <span style="background: #673f21; color: white; padding: 5px 15px; border-radius: 5px; font-weight: bold;">${code}</span>
            </p>
          </div>
          <div style="background: #e8f0f7; padding: 15px; border-left: 4px solid #27446e; margin: 20px 0;">
            <p style="margin: 0;"><strong>Action requise:</strong></p>
            <ol style="margin: 10px 0;">
              <li>Vérifier le paiement (Wave/Orange Money), le cas échéant</li>
              <li>Valider l'inscription ID <strong>${inscriptionId}</strong> en choisissant le mode : en ligne, présentiel, ponctuel ou gratuit</li>
              <li>L'étudiant recevra automatiquement son message de bienvenue, accompagné de son reçu si un paiement a été enregistré</li>
            </ol>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email admin envoyé - MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('❌ Erreur email admin:', error);
    throw error;
  }
};

// ============================================================
// 📧 EMAIL DE BIENVENUE / VALIDATION (PDFs en Buffer — compatible Vercel)
//
//  Envoyé aux 4 modes :
//    EN_LIGNE / PRESENTIEL → bienvenue + reçu PDF + guide PDF
//    PONCTUEL              → bienvenue + reçu PDF
//    GRATUIT               → bienvenue seule (aucun reçu, aucun guide)
//
//  Peut aussi être réutilisé quand un étudiant GRATUIT passe à un mode
//  payant (modification) : il reçoit alors son reçu avec le message.
//
//  mensualite        → optionnel (null/0 = paiement unique)
//  estPaiementUnique → flag explicite envoyé par le contrôleur
//  universite / promotion / filiere → affichés pour le mode GRATUIT
// ============================================================
export const envoyerEmailValidation = async ({
  nomComplet,
  email,
  formation,
  code,
  telephone,
  mode,                // 'EN_LIGNE' | 'PRESENTIEL' | 'PONCTUEL' | 'GRATUIT'
  montantInscription,  // ignoré pour GRATUIT
  mensualite,          // null ou 0 pour paiement unique
  nombreMois,
  estPaiementUnique,   // booléen envoyé par validerInscription()
  cohorte,
  inscriptionId,
  universite,
  promotion,
  filiere
}) => {
  const MAX_RETRIES = 3;
  let lastError;

  const estGratuit          = mode === 'GRATUIT';
  const estPonctuel         = mode === 'PONCTUEL';
  const estFormationPayante = !estGratuit && !estPonctuel; // EN_LIGNE, PRESENTIEL (ou appel sans mode)

  // S'assurer que le flag est cohérent même si le contrôleur ne l'envoie pas
  const _paiementUnique = estPaiementUnique || !mensualite || mensualite === 0;
  const montant = montantInscription ?? 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`📤 [${attempt}/${MAX_RETRIES}] Préparation email de bienvenue (${mode || 'sans mode'}) pour ${email}...`);

      // ✅ Génération en mémoire — pas de disque, compatible Vercel
      const attachments = [];

      if (!estGratuit) {
        const recuBuffer = await genererRecuInscriptionBuffer({
          nomComplet,
          email,
          telephone,
          formation,
          montantInscription: montant,
          inscriptionId,
          mode,
          dateInscription: new Date()
        });
        attachments.push({
          filename: `Recu_${estPonctuel ? 'Paiement' : 'Inscription'}_${inscriptionId}.pdf`,
          content: recuBuffer,
          contentType: 'application/pdf'
        });
      }

      if (estFormationPayante) {
        const guideBuffer = await genererGuideBienvenueBuffer({
          nomComplet,
          formation,
          nombreMois,
          mensualite,   // null si paiement unique → le PDF s'adapte
          inscriptionId
        });
        attachments.push({
          filename: `Guide_Bienvenue_${inscriptionId}.pdf`,
          content: guideBuffer,
          contentType: 'application/pdf'
        });
      }

      console.log(`✅ ${attachments.length} pièce(s) jointe(s) générée(s) en mémoire`);

      // ── Blocs communs ─────────────────────────────────────────────────
      const enTete = `
        <p style="margin: 0 0 20px 0; font-size: 14px;">Dakar, le ${dateDuJour()}</p>
        <p style="margin: 0 0 20px 0;">Madame, Monsieur <strong>${nomComplet}</strong>,</p>
        <p style="margin: 0 0 15px 0; text-align: justify;">
          Bienvenue chez TellyTech Formation. Nous sommes heureux de vous compter parmi nos étudiants.
        </p>
      `;

      const blocCode = `
        <p style="margin: 0 0 15px 0;">
          Votre code d'accès : <strong style="color: #27446e; font-size: 16px;">${code}</strong>
        </p>
        <p style="margin: 0 0 15px 0; text-align: justify;">
          Ce code vous permet de vous connecter à la plateforme de formation.
        </p>
      `;

      const signature = `
        <div style="margin: 30px 0 0 0;">
          <p style="margin: 0; font-weight: bold; color: #27446e;">Jean Mamady Cissé</p>
          <p style="margin: 0; font-size: 13px; color: #673f21;">Manager - TellyTech Formation</p>
        </div>
      `;

      // ── Corps spécifique au mode ──────────────────────────────────────
      let corpsSpecifique;

      if (estGratuit) {
        // ── GRATUIT : bienvenue, aucune notion de paiement ───────────────
        const lignesInfos = [
          universite && `Université : <strong>${universite}</strong>`,
          promotion  && `Promotion : <strong>${promotion}</strong>`,
          filiere    && `Filière : <strong>${filiere}</strong>`,
          telephone  && `Téléphone : <strong>${telephone}</strong>`
        ].filter(Boolean);

        const blocInfos = lignesInfos.length
          ? `
            <div style="background: #f9fafb; padding: 20px; margin: 20px 0; border-left: 3px solid #673f21;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #673f21;">Informations enregistrées</p>
              ${lignesInfos.map(l => `<p style="margin: 0 0 8px 0;">${l}</p>`).join('')}
            </div>
          `
          : '';

        corpsSpecifique = `
          <p style="margin: 0 0 15px 0; text-align: justify;">
            Nous avons le plaisir de vous confirmer votre inscription à la formation
            <strong>"${formation}"</strong> au titre de la partie gratuite de TellyTech Formation.
          </p>

          <div style="background: #e8f0f7; padding: 20px; margin: 20px 0; border-left: 4px solid #27446e;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #27446e;">Partie gratuite</p>
            <p style="margin: 0; text-align: justify;">
              Aucun paiement ne vous est demandé. Les frais d'inscription, les mensualités et
              les reçus de paiement ne vous concernent pas.
            </p>
          </div>

          ${blocCode}
          ${blocInfos}
        `;

      } else if (estPonctuel) {
        // ── PONCTUEL : petits montants libres, reçu joint ────────────────
        corpsSpecifique = `
          <p style="margin: 0 0 15px 0; text-align: justify;">
            Nous confirmons votre inscription à la formation <strong>"${formation}"</strong>
            en formule ponctuelle. Votre paiement de
            <strong>${montant.toLocaleString('fr-FR')} FCFA</strong> a été enregistré
            et votre reçu est joint à ce message.
          </p>

          ${blocCode}

          <div style="background: #f9fafb; padding: 20px; margin: 20px 0; border-left: 3px solid #673f21;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #673f21;">Modalités financières</p>
            <p style="margin: 0 0 8px 0;">Montant réglé : <strong>${montant.toLocaleString('fr-FR')} FCFA</strong></p>
            <p style="margin: 0; text-align: justify;">
              Cette formule ne comporte pas d'échéancier de mensualités.
              Un reçu vous est remis pour chaque paiement enregistré.
            </p>
          </div>
        `;

      } else {
        // ── EN_LIGNE / PRESENTIEL : paiement mensuel ou unique ───────────
        const phraseMode = PHRASE_MODE[mode] ? `, ${PHRASE_MODE[mode]}` : '';

        const blocFinancierHtml = _paiementUnique
          ? `
            <div style="background: #f9fafb; padding: 20px; margin: 20px 0; border-left: 3px solid #673f21;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #673f21;">Modalités financières</p>
              <p style="margin: 0 0 8px 0;">Frais d'inscription : <strong>${montant.toLocaleString('fr-FR')} FCFA</strong></p>
              <p style="margin: 0 0 8px 0;">Durée : <strong>${nombreMois} mois</strong></p>
              <p style="margin: 0; background: #f0fdf4; padding: 8px 12px; border-radius: 4px;
                        color: #15803d; font-weight: bold;">
                Paiement unique : aucune mensualité requise
              </p>
            </div>
          `
          : `
            <div style="background: #f9fafb; padding: 20px; margin: 20px 0; border-left: 3px solid #673f21;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #673f21;">Modalités financières</p>
              <p style="margin: 0 0 8px 0;">Frais d'inscription : <strong>${montant.toLocaleString('fr-FR')} FCFA</strong></p>
              <p style="margin: 0 0 8px 0;">Mensualité : <strong>${mensualite.toLocaleString('fr-FR')} FCFA / mois</strong></p>
              <p style="margin: 0 0 8px 0;">Durée : <strong>${nombreMois} mois</strong></p>
              <p style="margin: 0; background: #fffbeb; padding: 8px 12px; border-radius: 4px;
                        color: #92400e; font-weight: bold;">
                Total à régler : ${(mensualite * nombreMois).toLocaleString('fr-FR')} FCFA sur ${nombreMois} mois
              </p>
            </div>
          `;

        const texteModalites = _paiementUnique
          ? `Votre formation est entièrement réglée. Le certificat sera délivré après validation
             de tous les modules et du projet final.`
          : `Les paiements mensuels sont à effectuer avant le 10 de chaque mois via votre espace étudiant.
             Le certificat sera délivré après validation complète des ${nombreMois} mois et du projet final.`;

        corpsSpecifique = `
          <p style="margin: 0 0 15px 0; text-align: justify;">
            Nous confirmons votre inscription à la formation <strong>"${formation}"</strong>${phraseMode}.
            Votre paiement de <strong>${montant.toLocaleString('fr-FR')} FCFA</strong> a été enregistré.
          </p>

          ${blocCode}
          ${blocFinancierHtml}

          <p style="margin: 0 0 15px 0; text-align: justify;">${texteModalites}</p>
          <p style="margin: 30px 0 15px 0;">Veuillez consulter les documents joints pour plus de détails.</p>
        `;
      }

      const mailOptions = {
        from: `"TellyTech Formation" <${process.env.EMAIL_USER}>`,
        to: email,
        replyTo: process.env.EMAIL_USER,
        subject: `Bienvenue chez TellyTech Formation - Confirmation d'inscription`,
        html: `
          <div style="font-family: 'Georgia', serif; max-width: 650px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb;">
            <div style="background: #27446e; padding: 30px; text-align: center;">
              <h1 style="color: #fff; margin: 0; font-size: 26px; letter-spacing: 2px;">TELLYTECH</h1>
              <p style="color: #fff; margin: 8px 0 0 0; font-size: 13px; opacity: 0.9;">École de Formation Professionnelle</p>
            </div>
            <div style="padding: 40px; line-height: 1.8; color: #1f2937;">
              ${enTete}
              ${corpsSpecifique}
              <p style="margin: 25px 0 0 0; text-align: justify;">
                Nous vous souhaitons une excellente formation et restons à votre disposition
                pour toute question.
              </p>
              ${signature}
            </div>
            <div style="background: #f9fafb; padding: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 5px 0; color: #27446e; font-size: 13px; font-weight: bold;">Contact</p>
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                Email : technologytelly@gmail.com<br>
                Tél : +221 78 111 87 69<br>
                Adresse : Dakar, Sénégal
              </p>
            </div>
          </div>
        `,
        attachments
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email de bienvenue envoyé à ${email} - MessageID: ${info.messageId}`);
      return { success: true, messageId: info.messageId, email, attempt };

    } catch (error) {
      lastError = error;
      console.error(`❌ Tentative ${attempt}/${MAX_RETRIES} échouée:`, error.message);

      if (attempt < MAX_RETRIES) {
        const delayMs = attempt * 3000;
        console.log(`⏳ Nouvelle tentative dans ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(`❌ ÉCHEC après ${MAX_RETRIES} tentatives pour ${email}`);
  throw new Error(`Email non envoyé après ${MAX_RETRIES} tentatives: ${lastError.message}`);
};