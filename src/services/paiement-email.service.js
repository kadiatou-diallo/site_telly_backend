import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ============================================================
// 🔧 Utilitaire : "Février 2026" → "Fevrier2026"
//    (pour les noms de fichiers PDF : sans accent ni espace)
// ============================================================
export const slugMois = (label) =>
  String(label || 'Mois')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');

// ============================================================
// 📄 Reçu PDF mensuel EN BUFFER
//    `moisLabel` = "Février 2026" (mois calendaire réel).
//    Si absent (anciennes données sans dateDemarrage) → "Mois X".
// ============================================================
export const genererRecuMensuelPDF = async ({
  nomComplet,
  email,
  telephone,
  formation,
  mois,
  moisLabel,
  montant,
  paiementId,
  dateValidation = new Date()
}) => {
  return new Promise((resolve, reject) => {
    try {
      const libelleMois = moisLabel || `Mois ${mois}`;

      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        console.log('✅ PDF mensuel généré en mémoire');
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // Logo (optionnel)
      const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 40, { width: 150 });
      }

      // Infos école
      doc.fontSize(10)
         .fillColor('#2563eb')
         .font('Helvetica-Bold')
         .text('TELLYTECH', 400, 45, { align: 'right' })
         .font('Helvetica')
         .fontSize(9)
         .fillColor('#6b7280')
         .text('École de Formation Professionnelle', 400, 62, { align: 'right' })
         .text('Dakar, Sénégal', 400, 75, { align: 'right' })
         .text('Tél: +221 78 111 87 69', 400, 88, { align: 'right' })
         .text('technologytelly@gmail.com', 400, 101, { align: 'right' });

      // Ligne de séparation
      doc.moveTo(50, 130).lineTo(545, 130).strokeColor('#e5e7eb').stroke();

      // Titre
      doc.fontSize(22)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text('REÇU DE PAIEMENT MENSUEL', 50, 150, { align: 'center' });

      // Numéro et date
      doc.fontSize(10)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text(`N° ${String(paiementId).padStart(5, '0')}`, 50, 190)
         .text(`Date: ${dateValidation.toLocaleDateString('fr-FR', {
           day: '2-digit',
           month: 'long',
           year: 'numeric'
         })}`, 400, 190);

      // 🆕 Badge avec le VRAI MOIS (ex : "FÉVRIER 2026") — plus large qu'avant
      doc.roundedRect(172, 220, 250, 40, 5)
         .fillAndStroke('#3b82f6', '#2563eb');

      doc.fontSize(18)
         .fillColor('#ffffff')
         .font('Helvetica-Bold')
         .text(libelleMois.toUpperCase(), 172, 232, { width: 250, align: 'center' });

      // Informations client
      let yPos = 280;
      doc.fontSize(13)
         .fillColor('#1f2937')
         .font('Helvetica-Bold')
         .text('INFORMATIONS DE L\'ÉTUDIANT', 50, yPos);

      yPos += 25;
      doc.fontSize(11)
         .fillColor('#374151')
         .font('Helvetica')
         .text(`Nom complet:`, 50, yPos)
         .font('Helvetica-Bold')
         .text(nomComplet, 180, yPos);

      yPos += 20;
      doc.font('Helvetica')
         .text(`Email:`, 50, yPos)
         .font('Helvetica-Bold')
         .text(email, 180, yPos);

      yPos += 20;
      doc.font('Helvetica')
         .text(`Téléphone:`, 50, yPos)
         .font('Helvetica-Bold')
         .text(telephone, 180, yPos);

      yPos += 20;
      doc.font('Helvetica')
         .text(`Formation:`, 50, yPos)
         .font('Helvetica-Bold')
         .text(formation, 180, yPos);

      // Détails du paiement
      yPos += 50;
      doc.rect(50, yPos, 495, 30)
         .fillAndStroke('#f3f4f6', '#e5e7eb');

      doc.fillColor('#1f2937')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('DESCRIPTION', 60, yPos + 10)
         .text('MONTANT', 450, yPos + 10);

      yPos += 30;
      doc.rect(50, yPos, 495, 40).stroke('#e5e7eb');

      // 🆕 Plus de "/6" codé en dur : on affiche le mois réel
      doc.fillColor('#374151')
         .font('Helvetica')
         .text(`Mensualité de ${libelleMois} - ${formation}`, 60, yPos + 12, { width: 350 })
         .fontSize(12)
         .fillColor('#10b981')
         .font('Helvetica-Bold')
         .text(`${montant.toLocaleString('fr-FR')} FCFA`, 420, yPos + 12);

      // Total
      yPos += 40;
      doc.rect(50, yPos, 495, 35)
         .fillAndStroke('#dbeafe', '#3b82f6');

      doc.fontSize(14)
         .fillColor('#1e40af')
         .font('Helvetica-Bold')
         .text('TOTAL PAYÉ', 60, yPos + 10)
         .fontSize(16)
         .fillColor('#10b981')
         .text(`${montant.toLocaleString('fr-FR')} FCFA`, 400, yPos + 10);

      // Statut
      yPos += 60;
      doc.fontSize(14)
         .fillColor('#10b981')
         .font('Helvetica-Bold')
         .text('✓ PAIEMENT CONFIRMÉ', 50, yPos, { align: 'center' });

      // Filigrane
      doc.fontSize(60)
         .fillColor('#10b981')
         .opacity(0.08)
         .text('PAYÉ', 150, 380, { width: 300, align: 'center', angle: -30 });

      doc.opacity(1);

      // Signature et cachet
      const signatureY = 600;
      const signaturePath = path.join(process.cwd(), 'assets', 'signature.png');
      const cachetPath = path.join(process.cwd(), 'assets', 'cachet.png');

      doc.fontSize(10)
         .fillColor('#374151')
         .font('Helvetica')
         .text('Le Directeur', 80, signatureY);

      if (fs.existsSync(signaturePath)) {
        doc.image(signaturePath, 70, signatureY + 15, { width: 120, height: 60 });
      } else {
        doc.fontSize(22)
           .fillColor('#2563eb')
           .font('Helvetica-Oblique')
           .text('TellyTech', 70, signatureY + 20);
      }

      doc.fontSize(9)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('_________________', 60, signatureY + 70);

      if (fs.existsSync(cachetPath)) {
        doc.image(cachetPath, 400, signatureY - 10, { width: 110, height: 110 });
      } else {
        doc.circle(455, signatureY + 45, 50)
           .lineWidth(3)
           .strokeColor('#2563eb')
           .stroke();

        // 🆕 Année dynamique (avant : "2025" codé en dur)
        doc.fontSize(14)
           .fillColor('#2563eb')
           .font('Helvetica-Bold')
           .text('TELLYTECH', 415, signatureY + 25, { width: 80, align: 'center' })
           .fontSize(9)
           .text('FORMATION', 415, signatureY + 45, { width: 80, align: 'center' })
           .text(String(dateValidation.getFullYear()), 415, signatureY + 71, { width: 80, align: 'center' });
      }

      // Bas de page
      doc.fontSize(9)
         .fillColor('#9ca3af')
         .font('Helvetica')
         .text('Ce reçu atteste du paiement de la mensualité. Conservez-le précieusement.', 50, 720, { align: 'center' })
         .text('Merci de votre confiance !', { align: 'center' })
         .text('technologytelly@gmail.com | +221 78 111 87 69', { align: 'center' });

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

// ============================================================
// 📧 Email à l'étudiant : Paiement validé (avec reçu en pièce jointe)
//    Le mois est affiché en toutes lettres : "Février 2026"
// ============================================================
export const envoyerEmailPaiementValide = async ({
  nomComplet,
  email,
  telephone,
  formation,
  mois,
  moisLabel,
  montant,
  paiementId,
  recuBuffer
}) => {
  try {
    const libelleMois = moisLabel || `Mois ${mois}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `✅ Reçu de ${libelleMois} - ${formation}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10b981;">✅ Votre paiement est confirmé !</h2>

          <p>Bonjour <strong>${nomComplet}</strong>,</p>

          <p>Nous avons bien reçu votre paiement pour <strong>${libelleMois}</strong> de votre formation <strong>"${formation}"</strong>. 🎉</p>

          <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
            <p style="margin: 0; font-size: 14px;">Montant payé</p>
            <h1 style="margin: 10px 0; font-size: 36px;">${montant.toLocaleString('fr-FR')} FCFA</h1>
            <p style="margin: 0; font-size: 14px; text-transform: uppercase;">${libelleMois}</p>
          </div>

          <div style="background: #dbeafe; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
            <p style="margin: 0;"><strong>📌 Récapitulatif :</strong></p>
            <p style="margin: 5px 0;">Formation : ${formation}</p>
            <p style="margin: 5px 0;">Mois payé : ${libelleMois}</p>
            <p style="margin: 5px 0;">Montant : ${montant.toLocaleString('fr-FR')} FCFA</p>
          </div>

          <div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <p style="margin: 0;">📄 <strong>Votre reçu de paiement de ${libelleMois} est joint à cet email.</strong></p>
          </div>

          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
            Continuez comme ça ! 🚀<br>
            L'équipe TellyTech Formation
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `Recu_${slugMois(libelleMois)}_TellyTech.pdf`,
          content: recuBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Email paiement validé envoyé');
  } catch (error) {
    console.error('❌ Erreur email paiement validé:', error);
    throw error;
  }
};

// ============================================================
// 📧 Email de rappel de paiement
//    `moisManquants` : tableau de libellés ("Février 2026", …)
//    ou de numéros (anciennes inscriptions sans dateDemarrage).
// ============================================================
export const envoyerEmailRappelPaiement = async ({
  nomComplet,
  email,
  formation,
  moisManquants,
  montantMensuel
}) => {
  try {
    const montantTotal = moisManquants.length * montantMensuel;

    // Normaliser : nombre → "Mois 3", texte → tel quel ("Février 2026")
    const libelles = moisManquants.map(m => (typeof m === 'number' ? `Mois ${m}` : String(m)));

    const listeFormatee = libelles.length === 1
      ? libelles[0]
      : `${libelles.slice(0, -1).join(', ')} et ${libelles[libelles.length - 1]}`;

    const phrasePeriode = libelles.length === 1
      ? `la période suivante : <strong>${listeFormatee}</strong>`
      : `les périodes suivantes : <strong>${listeFormatee}</strong>`;

    // Le bouton n'apparaît que si FRONTEND_URL est configurée
    const lienEspace = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/etudiant/dashboard`
      : null;

    const boutonEspace = lienEspace
      ? `
            <div style="text-align: center; margin: 35px 0 25px 0;">
              <a href="${lienEspace}"
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 35px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                📄 Consulter mon espace
              </a>
            </div>`
      : '';

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `📅 Rappel : Paiement de mensualité en attente - ${formation}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- En-tête -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px;">📅 Rappel de Paiement</h1>
            <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 14px;">TellyTech Formation Professionnelle</p>
          </div>

          <!-- Corps du message -->
          <div style="padding: 40px 30px; background: #ffffff;">
            <p style="font-size: 16px; color: #1f2937; margin-bottom: 20px;">
              Bonjour <strong style="color: #667eea;">${nomComplet}</strong>,
            </p>

            <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 25px;">
              Nous espérons que votre formation en <strong>${formation}</strong> se déroule bien ! 🎓
            </p>

            <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 25px;">
              Nous n'avons pas encore reçu votre mensualité pour ${phrasePeriode}.
            </p>

            <!-- Bloc d'information principal -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 5px solid #f59e0b; padding: 25px; border-radius: 8px; margin: 30px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">📋 Détails du paiement en attente</h3>

              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #78350f; font-size: 15px;">
                    <strong>Formation :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #92400e; font-size: 15px; text-align: right;">
                    ${formation}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #78350f; font-size: 15px;">
                    <strong>Mois en attente :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #92400e; font-size: 15px; text-align: right;">
                    ${libelles.join(', ')}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #78350f; font-size: 15px;">
                    <strong>Nombre de mois :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #92400e; font-size: 15px; text-align: right;">
                    ${libelles.length} mois
                  </td>
                </tr>
                <tr style="border-top: 2px solid #f59e0b;">
                  <td style="padding: 15px 0 0 0; color: #78350f; font-size: 16px;">
                    <strong>💰 Montant total dû :</strong>
                  </td>
                  <td style="padding: 15px 0 0 0; text-align: right;">
                    <span style="background: #f59e0b; color: white; padding: 8px 16px; border-radius: 6px; font-size: 18px; font-weight: bold;">
                      ${montantTotal.toLocaleString('fr-FR')} FCFA
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Instructions de paiement -->
            <div style="background: #f0f9ff; border-left: 5px solid #3b82f6; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 17px;">💳 Moyens de paiement acceptés</h3>

              <div style="margin-bottom: 12px;">
                <p style="margin: 5px 0; color: #1e40af; font-size: 14px;">
                  <strong>📱 Wave :</strong> <span style="color: #3b82f6;">+221 78 111 87 69</span>
                </p>
              </div>

              <div style="margin-bottom: 12px;">
                <p style="margin: 5px 0; color: #1e40af; font-size: 14px;">
                  <strong>🍊 Orange Money :</strong> <span style="color: #3b82f6;">+221 78 111 87 69</span>
                </p>
              </div>

              <div style="background: #dbeafe; padding: 12px; border-radius: 6px; margin-top: 15px;">
                <p style="margin: 0; color: #1e3a8a; font-size: 13px; line-height: 1.5;">
                  ℹ️ <strong>Important :</strong> Une fois votre paiement effectué, l'administration l'enregistre et le valide. Vous recevez alors automatiquement votre reçu par email. Pour toute question, contactez-nous au +221 78 111 87 69.
                </p>
              </div>
            </div>

            <!-- Message encourageant -->
            <div style="background: #f0fdf4; border-left: 5px solid #10b981; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
                ✨ <strong>Nous sommes là pour vous !</strong><br>
                Nous comprenons que des difficultés financières peuvent survenir. Si vous rencontrez des problèmes pour effectuer votre paiement, n'hésitez pas à nous contacter. Nous ferons de notre mieux pour trouver une solution ensemble.
              </p>
            </div>

            ${boutonEspace}

            <!-- Message de clôture -->
            <div style="margin-top: 35px; padding-top: 25px; border-top: 2px solid #e5e7eb;">
              <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 15px;">
                Nous vous remercions pour votre confiance et restons à votre disposition pour toute question.
              </p>

              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                Cordialement,<br>
                <strong style="color: #667eea;">L'équipe TellyTech Formation</strong>
              </p>
            </div>
          </div>

          <!-- Pied de page -->
          <div style="background: #f9fafb; padding: 25px 30px; border-radius: 0 0 10px 10px; border-top: 1px solid #e5e7eb;">
            <table style="width: 100%;">
              <tr>
                <td style="text-align: center; padding-bottom: 10px;">
                  <p style="margin: 0; color: #9ca3af; font-size: 13px;">
                    📧 <a href="mailto:technologytelly@gmail.com" style="color: #667eea; text-decoration: none;">technologytelly@gmail.com</a>
                  </p>
                  <p style="margin: 5px 0 0 0; color: #9ca3af; font-size: 13px;">
                    📞 +221 78 111 87 69
                  </p>
                </td>
              </tr>
              <tr>
                <td style="text-align: center; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                    TellyTech - École de Formation Professionnelle<br>
                    Dakar, Sénégal
                  </p>
                  <p style="margin: 10px 0 0 0; color: #d1d5db; font-size: 10px;">
                    © ${new Date().getFullYear()} TellyTech. Tous droits réservés.
                  </p>
                </td>
              </tr>
            </table>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email rappel envoyé à ${email}`);

    return { success: true, email };
  } catch (error) {
    console.error(`❌ Erreur envoi rappel à ${email}:`, error);
    throw error;
  }
};