# Usar una imagen ligera de Node.js
FROM node:18-slim

# Crear directorio de la app
WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto que usará el Bridge
EXPOSE 8080

# Comando para arrancar la aplicación
CMD [ "node", "bridge.js" ]
