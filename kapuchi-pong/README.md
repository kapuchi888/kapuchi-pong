# KAPUCHI PONG 🎮

Juego de Pong multijugador online con estilo retro-futurista.

## Características
- Multijugador online en tiempo real (Socket.io)
- Sala de espera con código de invitación
- Perspectiva personalizada (tu paleta siempre abajo)
- Sistema de ranking / clasificación
- Efectos de partículas y animaciones
- Diseño retro-futurista con estética neón
- Optimizado para móvil en posición horizontal

## Instalación local

```bash
npm install
npm start
```
Abre http://localhost:3000

## Deploy en Render

1. Sube el proyecto a GitHub
2. Ve a https://render.com
3. New → Web Service → conecta tu repo
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Deploy!

## Cómo jugar
1. Introduce tu nombre
2. Crea una sala o únete con un código
3. Comparte el código con tu amigo
4. ¡A jugar! Desliza tu dedo para mover la paleta
5. El primero en llegar a 7 puntos gana

## Estructura
```
kapuchi-pong/
├── server.js          # Servidor Node.js + Socket.io
├── package.json
├── render.yaml        # Config para Render
└── public/
    └── index.html     # Frontend del juego
```
