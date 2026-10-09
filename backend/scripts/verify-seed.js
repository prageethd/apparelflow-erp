const prisma = require("../src/config/prisma");

function isBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, fullName: true, passwordHash: true },
    orderBy: { email: "asc" },
  });
  const recipes = await prisma.recipe.findMany({
    select: {
      recipeCode: true,
      name: true,
      _count: { select: { components: true } },
    },
    orderBy: { recipeCode: "asc" },
  });
  const componentCount = await prisma.recipeComponent.count();

  console.log("USER_COUNT=" + users.length);
  console.log(
    "USER_EMAILS=" + users.map((user) => user.email).join(",")
  );
  console.log(
    "ALL_PASSWORDS_HASHED=" + users.every((user) => isBcryptHash(user.passwordHash))
  );
  console.log("RECIPE_COUNT=" + recipes.length);
  console.log(
    "RECIPE_CODES=" + recipes.map((recipe) => recipe.recipeCode).join(",")
  );
  console.log(
    "COMPONENT_COUNTS=" +
      recipes.map((recipe) => recipe.recipeCode + ":" + recipe._count.components).join(",")
  );
  console.log("COMPONENT_TOTAL=" + componentCount);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("VERIFY_FAILED=" + error.message);
  await prisma.$disconnect();
  process.exit(1);
});
