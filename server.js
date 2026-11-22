import { config } from "dotenv";
config({ override: true });

import app from "./src/app.js";

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});