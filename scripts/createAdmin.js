import prisma from '../src/config/database.js';
import bcrypt from 'bcrypt';

async function createAdmin() {
  try {
    // Vérifier si l'admin existe déjà
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'kadiatoutelly@gmail.com' }
    });

    if (existingAdmin) {
      console.log('⚠️  Cet admin existe déjà !');
      console.log('📧 Email:', existingAdmin.email);
      console.log('👤 Nom:', existingAdmin.nom);
      console.log('🔑 Role:', existingAdmin.role);
      return;
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash('8090', 10);

    // Créer l'admin
    const admin = await prisma.user.create({
      data: {
        nom: 'Admin Telly',
        email: 'kadiatou685telly@gmail.com',
        password: hashedPassword,
        role: 'ADMIN'
      }
    });

    console.log('✅ Admin créé avec succès !');
    console.log('📧 Email:', admin.email);
    console.log('🔐 Mot de passe: 2025');
    console.log('🔑 Role:', admin.role);
    console.log('🆔 ID:', admin.id);

  } catch (error) {
    console.error('❌ Erreur lors de la création de l\'admin:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();