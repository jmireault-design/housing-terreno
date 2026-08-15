// middleware.js
// Protège tout le site Terreno par mot de passe (HTTP Basic Auth), via Vercel Edge
// Middleware. Le nom d'utilisateur/mot de passe sont lus depuis des variables
// d'environnement Vercel (jamais écrits ici, donc jamais visibles sur GitHub).

export const config = {
  matcher: "/:path*",
};

export default function middleware(request) {
  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const separatorIndex = decoded.indexOf(":");
      const user = decoded.slice(0, separatorIndex);
      const pass = decoded.slice(separatorIndex + 1);

      if (user === process.env.BASIC_AUTH_USER && pass === process.env.BASIC_AUTH_PASSWORD) {
        return; // Identifiants corrects — laisse passer la requête normalement
      }
    }
  }

  return new Response("Authentification requise.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Terreno"',
    },
  });
}