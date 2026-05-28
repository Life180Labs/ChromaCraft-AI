FROM node:20-slim

# Install Python, openssl, system dependencies, OpenCV, and FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl python3 python3-pip python3-venv make g++ \
    libpng-dev libjpeg-dev zlib1g-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY python/requirements.txt ./python/
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r ./python/requirements.txt

# Install Node dependencies
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy application files
COPY worker.ts ./
COPY orchestrator.ts ./
COPY python/ ./python/

# Generate Prisma Client
COPY prisma/schema.prisma ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript
RUN npx tsc worker.ts --target es2022 --module commonjs --esModuleInterop --moduleResolution node

CMD npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 | tail -1 && node worker.js
