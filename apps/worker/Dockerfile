FROM node:20-alpine

# Install Python, openssl & system dependencies
RUN apk add --no-cache openssl python3 py3-pip make g++ python3-dev libpng-dev jpeg-dev zlib-dev

# Set up virtual environment and install python dependencies
WORKDIR /app
COPY python/requirements.txt ./python/
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r ./python/requirements.txt

# Install Node dependencies
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy application files
COPY worker.ts ./
COPY python/ ./python/

# Generate Prisma Client
COPY prisma/schema.prisma ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript to JavaScript with compiler options enabled
RUN npx tsc worker.ts --target es2022 --module commonjs --esModuleInterop --moduleResolution node

CMD ["node", "worker.js"]
