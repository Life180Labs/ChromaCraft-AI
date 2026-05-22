FROM node:20-alpine

WORKDIR /app

# Install dependencies needed for node native modules and prisma openssl
RUN apk add --no-cache libc6-compat openssl make g++ python3

COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy application files
COPY . .

# Generate Prisma Client from local schema
RUN npx prisma generate --schema=./prisma/schema.prisma

EXPOSE 3000

CMD ["npm", "run", "dev"]
