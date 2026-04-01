FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
RUN mkdir -p data public
EXPOSE 3100
CMD ["node", "src/index.js"]
