import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import formationRoutes from "./routes/formation.routes.js";
import messageRoutes from "./routes/message.routes.js";
import inscriptionRoutes from "./routes/inscription.routes.js";
import authRoutes from './routes/auth.routes.js';
import paiementRoutes from "./routes/paiement.routes.js";
import submissionRoutes from "./routes/submission.routes.js";
import progressRoutes from "./routes/progress.routes.js";
import courseRoutes from './routes/course.routes.js';
import DevoirRoutes from './routes/devoir.routes.js';
import emploiDuTempsRoutes from './routes/emploiDuTemps.routes.js';
import articleRoutes from "./routes/article.routes.js";
import commentaireRoutes from "./routes/commentaire.routes.js";
import likeRoutes from "./routes/like.routes.js";
import galerieRoutes from "./routes/galerie.routes.js";

dotenv.config();

const app = express();

// ✅ CORS corrigé pour Vercel - sans '*' avec credentials
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'https://telly-tech.com',
  'https://www.telly-tech.com',
  'https://tellytech-backkend-rkms.vercel.app',
  'https://sparkling-glade-3839.pages.dev',
  'https://site-telly-backend.vercel.app'
];

app.use(cors({
  origin: function(origin, callback) {
    // Permettre les requêtes sans origin (Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS non autorisé'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));



app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8000;

// Route racine
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "TellyTech API fonctionne !",
    endpoints: {
      formations:   "/api/formations",
      inscriptions: "/api/inscriptions",
      paiements:    "/api/paiements",
      messages:     "/api/messages",
      auth:         "/api/auth",
      courses:      "/api/courses",
      devoir:       "/api/devoir",
      emploi:       "/api/emploie"
    }
  });
});

// Routes API
app.use("/api/formations",   formationRoutes);
app.use("/api/paiements",    paiementRoutes);
app.use("/api/messages",     messageRoutes);
app.use("/api/inscriptions", inscriptionRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/submissions',  submissionRoutes);
app.use('/api/courses',      courseRoutes);
app.use('/api/progress',     progressRoutes);
app.use('/api/emploie',      emploiDuTempsRoutes);
app.use('/api/devoir',       DevoirRoutes);
app.use("/api", articleRoutes);
app.use("/api", commentaireRoutes);
app.use("/api", likeRoutes);
app.use("/api", galerieRoutes);

// 404 - Route non trouvée
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route non trouvée",
    path: req.originalUrl
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error("❌ Erreur:", err);

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: "Erreur lors de l'upload du fichier",
      error: err.message
    });
  }

  res.status(500).json({
    success: false,
    message: 'Une erreur est survenue sur le serveur',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

export default app;