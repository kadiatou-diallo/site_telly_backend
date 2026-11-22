import prisma from '../config/database.js';
import { transporter } from './email.service.js';

const TYPES = {
  ANNONCE:   { label: 'Annonce',   couleur: '#27446e' },
  EVENEMENT: { label: 'Événement', couleur: '#673f21' },
  DEMANDE:   { label: 'Demande',   couleur: '#27446e' },
};

const echapper = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Filtres → where Prisma
export const construireWhere = (f = {}) => {
  const where = {};
  if (f.statut)     where.status    = f.statut; // PENDING | VALIDATED
  if (f.mode)       where.mode      = f.mode;   // EN_LIGNE | PRESENTIEL | PONCTUEL | GRATUIT
  if (f.formation)  where.formation = { contains: f.formation, mode: 'insensitive' };
  if (f.cohorte)    where.cohorte   = parseInt(f.cohorte);
  if (f.estActif === true || f.estActif === false) where.estActif = f.estActif;
  return where;
};

// Variables disponibles dans le message : {{prenom}} {{nom}} {{formation}}
const personnaliser = (texte, d) =>
  texte
    .replace(/{{\s*prenom\s*}}/gi, d.prenom)
    .replace(/{{\s*nom\s*}}/gi, d.nomComplet)
    .replace(/{{\s*formation\s*}}/gi, d.formation);

const construireHtml = ({ type, sujet, contenu }, d) => {
  const t = TYPES[type] ?? TYPES.ANNONCE;
  const corps = echapper(personnaliser(contenu, d)).replace(/\n/g, '<br>');
  return `
    <div style="font-family: 'Georgia', serif; max-width: 650px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb;">
      <div style="background: #27446e; padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 26px; letter-spacing: 2px;">TELLYTECH</h1>
        <p style="color: #fff; margin: 8px 0 0 0; font-size: 13px; opacity: 0.9;">École de Formation Professionnelle</p>
      </div>
      <div style="padding: 40px; line-height: 1.8; color: #1f2937;">
        <span style="background: ${t.couleur}; color: #fff; padding: 4px 12px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">${t.label}</span>
        <h2 style="color: #27446e; margin: 20px 0;">${echapper(personnaliser(sujet, d))}</h2>
        <p style="margin: 0 0 15px 0;">Bonjour <strong>${echapper(d.prenom)}</strong>,</p>
        <p style="margin: 0 0 20px 0; text-align: justify;">${corps}</p>
        <div style="margin: 30px 0 0 0;">
          <p style="margin: 0; font-weight: bold; color: #27446e;">Jean Mamady Cissé</p>
          <p style="margin: 0; font-size: 13px; color: #673f21;">Manager - TellyTech Formation</p>
        </div>
      </div>
      <div style="background: #f9fafb; padding: 20px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #6b7280; font-size: 12px;">
          Email : technologytelly@gmail.com<br>Tél : +221 78 111 87 69<br>Dakar, Sénégal
        </p>
      </div>
    </div>`;
};

const envoyerUn = (campagne, d) =>
  transporter.sendMail({
    from: `"TellyTech Formation" <${process.env.EMAIL_USER}>`,
    to: d.email,
    replyTo: process.env.EMAIL_USER,
    subject: `${(TYPES[campagne.type] ?? TYPES.ANNONCE).label} - ${personnaliser(campagne.sujet, d)}`,
    html: construireHtml(campagne, d),
  });

// Envoi d'un test à soi-même
export const envoyerTest = (campagne, emailTest) =>
  envoyerUn(campagne, {
    email: emailTest,
    prenom: 'Prénom',
    nomComplet: 'Prénom Nom',
    formation: 'Formation exemple',
  });

// Envoie un lot de destinataires EN_ATTENTE et renvoie ce qui reste
export const envoyerLot = async (campagneId, taille = 25) => {
  const campagne = await prisma.campagne.findUnique({ where: { id: campagneId } });
  if (!campagne) throw new Error('Campagne introuvable');

  const lot = await prisma.campagneDestinataire.findMany({
    where: { campagneId, statut: 'EN_ATTENTE' },
    orderBy: { id: 'asc' },
    take: taille,
  });

  // Verrou : évite qu'un double-clic envoie deux fois le même lot
  await prisma.campagneDestinataire.updateMany({
    where: { id: { in: lot.map((d) => d.id) }, statut: 'EN_ATTENTE' },
    data: { statut: 'EN_COURS' },
  });

  for (const d of lot) {
    try {
      await envoyerUn(campagne, d);
      await prisma.campagneDestinataire.update({
        where: { id: d.id },
        data: { statut: 'ENVOYE', envoyeAt: new Date(), erreur: null },
      });
    } catch (err) {
      await prisma.campagneDestinataire.update({
        where: { id: d.id },
        data: { statut: 'ECHEC', erreur: String(err.message).slice(0, 300) },
      });
    }
  }

  const restant = await prisma.campagneDestinataire.count({
    where: { campagneId, statut: 'EN_ATTENTE' },
  });
  if (restant === 0) {
    await prisma.campagne.update({ where: { id: campagneId }, data: { statut: 'TERMINEE' } });
  }
  return { traites: lot.length, restant };
};