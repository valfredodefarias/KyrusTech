# Production-ready pre-built static server
FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

# Copy pre-built production bundle from host
COPY dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]