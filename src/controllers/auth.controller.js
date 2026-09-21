import prisma from '../config/database.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// ─── Helper ───────────────────────────────────────────────────────────────────

const buildUserResponse = async (user) => {
  const base = {
    id:        user.id,
    email:     user.email,
    nom:       user.nom,
    role:      user.role,
    createdAt: user.createdAt,
  };

  if (user.role === 'USER') {
    base.formation = user.formation ?? null;
    base.cohorte   = user.cohorte   ?? null;

    if (!user.formation) {
      console.warn('⚠️ Étudiant sans formation :', user.email);
    }

    // 🆕 On lit aussi le mode (EN_LIGNE / PRESENTIEL / PONCTUEL / GRATUIT)
    const inscription = await prisma.inscription.findFirst({
      where:  { email: user.email, status: 'VALIDATED' },
      select: { id: true, mode: true },
    });

    base.inscriptionId = inscription?.id   ?? null;
    base.mode          = inscription?.mode ?? null;

    if (!base.inscriptionId) {
      console.warn('⚠️ Aucune inscription validée pour :', user.email);
    }
  }

  return base;
};

// 🔐 LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id:        true,
        email:     true,
        password:  true,
        nom:       true,
        role:      true,
        formation: true,
        cohorte:   true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const userResponse = await buildUserResponse(user);

    console.log('✅ Login réussi:', user.email, '| role:', user.role);
    if (user.role === 'USER') {
      console.log(
        '📚 Formation:', userResponse.formation,
        '| inscriptionId:', userResponse.inscriptionId,
        '| mode:', userResponse.mode
      );
    }

    res.json({ success: true, message: 'Connexion réussie', token, user: userResponse });

  } catch (error) {
    console.error('❌ Erreur login:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la connexion' });
  }
};

// 🚪 LOGOUT
export const logout = async (req, res) => {
  try {
    res.json({ success: true, message: 'Déconnexion réussie' });
  } catch (error) {
    console.error('❌ Erreur logout:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la déconnexion' });
  }
};

// 🔍 VERIFY TOKEN
export const verifyToken = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id:        true,
        email:     true,
        nom:       true,
        role:      true,
        formation: true,
        cohorte:   true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const userResponse = await buildUserResponse(user);

    res.json({ success: true, user: userResponse });

  } catch (error) {
    console.error('❌ Erreur verifyToken:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la vérification du token' });
  }
};