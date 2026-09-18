const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const TEMP = path.join(__dirname, "temp");

if (!fs.existsSync(TEMP)) {
  fs.mkdirSync(TEMP);
}

app.use("/photos", express.static(TEMP));


// ===============================
// UTILIDADES
// ===============================

function cleanCEP(cep) {
  return String(cep).replace(/\D/g, "");
}

function id() {
  return crypto.randomBytes(8).toString("hex");
}


// ===============================
// VIACEP
// ===============================

async function viaCEP(cep) {

  const response = await fetch(
    `https://viacep.com.br/ws/${cep}/json/`
  );

  if (!response.ok) {
    throw new Error("Falha no ViaCEP");
  }

  const data = await response.json();

  if (data.erro) {
    throw new Error("CEP não encontrado");
  }

  return data;
}


// ===============================
// GEOCODIFICAÇÃO
// ===============================

async function geocode(address) {

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: address,
      format: "json",
      limit: "1",
      countrycodes: "br"
    });

  const response = await fetch(url, {
    headers: {
      "User-Agent": "photo-fastcep/1.0"
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  if (!data.length) {
    return null;
  }

  return {
    latitude: Number(data[0].lat),
    longitude: Number(data[0].lon)
  };
}


// ===============================
// WIKIMEDIA COMMONS
// ===============================

async function searchImages(lat, lon) {

  const url =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "geosearch",
      ggsprimary: "all",
      ggslimit: "30",
      ggsnamespace: "6",
      ggsradius: "10000",
      ggscoord: `${lat}|${lon}`,
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: "1200",
      format: "json",
      origin: "*"
    });

  const response = await fetch(url);

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  const pages = Object.values(
    data.query?.pages || {}
  );

  return pages
    .map(page => {

      const info = page.imageinfo?.[0];

      if (!info) return null;

      if (!info.mime?.startsWith("image/")) {
        return null;
      }

      return {
        title: page.title,
        original: info.url,
        preview: info.thumburl || info.url,
        width: info.width,
        height: info.height
      };

    })
    .filter(Boolean);
}


// ===============================
// DOWNLOAD TEMPORÁRIO
// ===============================

async function downloadImage(url) {

  try {

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const type =
      response.headers.get("content-type") || "";

    if (!type.startsWith("image/")) {
      return null;
    }

    const buffer =
      Buffer.from(await response.arrayBuffer());

    const extension =
      type.includes("png")
        ? ".png"
        : type.includes("webp")
          ? ".webp"
          : ".jpg";

    const filename =
      id() + extension;

    const filepath =
      path.join(TEMP, filename);

    fs.writeFileSync(filepath, buffer);

    return filename;

  } catch {

    return null;
  }
}


// ===============================
// LIMPEZA
// ===============================

function cleanup() {

  const now = Date.now();

  for (const file of fs.readdirSync(TEMP)) {

    const filepath =
      path.join(TEMP, file);

    try {

      const stat =
        fs.statSync(filepath);

      // 15 minutos
      if (
        now - stat.mtimeMs >
        15 * 60 * 1000
      ) {
        fs.unlinkSync(filepath);
      }

    } catch {}
  }
}

setInterval(cleanup, 60 * 1000);


// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>photo-fastcep</title>

<style>

body {
  margin: 0;
  background: #090909;
  color: #eee;
  font-family: Arial, sans-serif;
}

main {
  max-width: 1100px;
  margin: auto;
  padding: 30px;
}

h1 {
  font-size: 32px;
}

input {
  width: 250px;
  padding: 14px;
  background: #151515;
  color: white;
  border: 1px solid #333;
  border-radius: 8px;
}

button {
  padding: 14px 22px;
  background: white;
  color: black;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

#gallery {
  margin-top: 30px;
  columns: 4 220px;
  column-gap: 12px;
}

.card {
  break-inside: avoid;
  margin-bottom: 12px;
  background: #111;
  border-radius: 10px;
  overflow: hidden;
}

.card img {
  width: 100%;
  display: block;
}

.info {
  padding: 10px;
  font-size: 12px;
  color: #aaa;
}

</style>
</head>

<body>

<main>

<h1>photo-fastcep</h1>

<p>
Consulte imagens por CEP.
</p>

<input
  id="cep"
  placeholder="Ex: 01001-000"
/>

<button onclick="buscar()">
Pesquisar
</button>

<div id="status"></div>

<div id="gallery"></div>

</main>

<script>

async function buscar() {

  const cep =
    document.getElementById("cep").value;

  const status =
    document.getElementById("status");

  const gallery =
    document.getElementById("gallery");

  gallery.innerHTML = "";

  status.innerText =
    "Buscando localização e imagens...";

  try {

    const response =
      await fetch("/api/photos/" + cep);

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Erro"
      );
    }

    status.innerHTML =
      "<p>" +
      data.endereco.completo +
      "</p>" +
      "<p>" +
      data.imagens.length +
      " imagens encontradas</p>";

    for (const image of data.imagens) {

      const card =
        document.createElement("div");

      card.className = "card";

      card.innerHTML = \`
        <img
          src="\${image.url}"
          loading="lazy"
        />

        <div class="info">
          \${image.titulo || ""}
        </div>
      \`;

      gallery.appendChild(card);
    }

  } catch (error) {

    status.innerText =
      error.message;

  }

}

</script>

</body>
</html>
`);
});


// ===============================
// API PRINCIPAL
// ===============================

app.get("/api/photos/:cep", async (req, res) => {

  try {

    const cep =
      cleanCEP(req.params.cep);

    if (cep.length !== 8) {

      return res.status(400).json({
        success: false,
        message: "CEP inválido"
      });

    }

    // 1. CEP
    const endereco =
      await viaCEP(cep);

    const query = [
      endereco.logradouro,
      endereco.bairro,
      endereco.localidade,
      endereco.uf,
      "Brasil"
    ]
      .filter(Boolean)
      .join(", ");

    // 2. Coordenadas
    const location =
      await geocode(query);

    if (!location) {

      return res.status(404).json({
        success: false,
        message:
          "Não foi possível localizar este endereço."
      });

    }

    // 3. Imagens
    const imagens =
      await searchImages(
        location.latitude,
        location.longitude
      );

    // 4. Baixar em paralelo
    const baixadas =
      await Promise.all(
        imagens.slice(0, 20).map(
          async image => {

            const file =
              await downloadImage(
                image.preview
              );

            if (!file) {
              return null;
            }

            return {
              id: file.split(".")[0],

              url:
                `/photos/${file}`,

              titulo:
                image.title
                  .replace("File:", ""),

              largura:
                image.width,

              altura:
                image.height
            };

          }
        )
      );

    const finalImages =
      baixadas.filter(Boolean);

    // 5. Resposta
    res.json({

      success: true,

      api: "photo-fastcep",

      consulta: {
        cep,
        cep_formatado:
          `${cep.slice(0, 5)}-${cep.slice(5)}`
      },

      endereco: {

        logradouro:
          endereco.logradouro || null,

        complemento:
          endereco.complemento || null,

        bairro:
          endereco.bairro || null,

        cidade:
          endereco.localidade || null,

        uf:
          endereco.uf || null,

        ibge:
          endereco.ibge || null,

        completo: query
      },

      localizacao: {

        latitude:
          location.latitude,

        longitude:
          location.longitude
      },

      imagens: finalImages,

      total:
        finalImages.length,

      validade: "15 minutos"

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({

      success: false,

      message:
        error.message ||
        "Erro interno"

    });

  }

});


// ===============================
// START
// ===============================

app.listen(PORT, () => {

  console.log(`
╔══════════════════════════════════╗
║          PHOTO-FASTCEP           ║
║                                  ║
║          ONLINE                  ║
║          PORTA ${PORT}              ║
╚══════════════════════════════════╝
`);

});