const express = require("express");
const prisma = require("../config/prisma");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const recipes = await prisma.recipe.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        recipeCode: true,
        name: true,
        category: true,
        stdFabricYards: true,
        wastageCap: true,
        components: {
          orderBy: { componentName: "asc" },
          select: {
            id: true,
            componentName: true,
            piecesPerGarment: true,
          },
        },
      },
    });

    return res.json({
      success: true,
      data: recipes.map((recipe) => ({
        ...recipe,
        stdFabricYards: Number(recipe.stdFabricYards),
        wastageCap: Number(recipe.wastageCap),
      })),
    });
  } catch (error) {
    console.error("Recipe listing failed");
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve recipes",
    });
  }
});

module.exports = router;