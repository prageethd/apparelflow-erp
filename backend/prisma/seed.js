require("dotenv").config();

const bcrypt = require("bcryptjs");
const prisma = require("../src/config/prisma");

const BCRYPT_ROUNDS = 10;

const DEMO_USERS = [
  {
    fullName: "Cutting Supervisor",
    role: "cutting_supervisor",
    email: "supervisor@apparelflow.com",
    password: "Supervisor123!",
  },
  {
    fullName: "Cutting Verifier",
    role: "cutting_verifier",
    email: "verifier@apparelflow.com",
    password: "Verifier123!",
  },
  {
    fullName: "Sewing Supervisor",
    role: "sewing_supervisor",
    email: "sewing@apparelflow.com",
    password: "Sewing123!",
  },
];

const DEMO_RECIPES = [
  {
    recipeCode: "REC-BL01",
    name: "Casual Blouse",
    category: "Blouse",
    stdFabricYards: "1.80",
    wastageCap: "5.00",
    components: [
      { componentName: "Front Body Panel", piecesPerGarment: 1 },
      { componentName: "Back Body Panel", piecesPerGarment: 1 },
      { componentName: "Sleeves (Left & Right)", piecesPerGarment: 2 },
      { componentName: "Collar & Stand", piecesPerGarment: 1 },
      { componentName: "Sleeve Cuffs", piecesPerGarment: 2 },
    ],
  },
  {
    recipeCode: "REC-CT02",
    name: "Crop Top",
    category: "Crop Top",
    stdFabricYards: "1.10",
    wastageCap: "8.00",
    components: [
      { componentName: "Front Chest Panel", piecesPerGarment: 1 },
      { componentName: "Back Support Panel", piecesPerGarment: 1 },
      { componentName: "Neck Binding Strip", piecesPerGarment: 1 },
      { componentName: "Hem Elastic Casing", piecesPerGarment: 1 },
      { componentName: "Side Strap Accents", piecesPerGarment: 2 },
    ],
  },
];

async function seedUsers() {
  for (const user of DEMO_USERS) {
    const existing = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });

    if (existing) {
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
    await prisma.user.create({
      data: {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        passwordHash,
      },
    });
  }
}

async function seedRecipes() {
  for (const recipe of DEMO_RECIPES) {
    const savedRecipe = await prisma.recipe.upsert({
      where: { recipeCode: recipe.recipeCode },
      create: {
        recipeCode: recipe.recipeCode,
        name: recipe.name,
        category: recipe.category,
        stdFabricYards: recipe.stdFabricYards,
        wastageCap: recipe.wastageCap,
      },
      update: {},
    });

    for (const component of recipe.components) {
      await prisma.recipeComponent.upsert({
        where: {
          recipeId_componentName: {
            recipeId: savedRecipe.id,
            componentName: component.componentName,
          },
        },
        create: {
          recipeId: savedRecipe.id,
          componentName: component.componentName,
          piecesPerGarment: component.piecesPerGarment,
        },
        update: {},
      });
    }
  }
}

async function main() {
  try {
    await seedUsers();
    await seedRecipes();

    const blouse = await prisma.recipe.findUnique({
      where: { recipeCode: "REC-BL01" },
    });
    const cropTop = await prisma.recipe.findUnique({
      where: { recipeCode: "REC-CT02" },
    });

    console.log("Seed completed successfully");
    console.log("Recipes:", blouse?.name, cropTop?.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown seed error";
    console.error("Seed failed:", message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
