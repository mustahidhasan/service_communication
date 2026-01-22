# =============================
# Stage 1: Base install
# =============================
FROM node:20 AS base
WORKDIR /app

# Copy dependencies and install
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# =============================
# Stage 2: Dev runtime
# =============================
FROM base AS dev
ARG ENV_FILE=.env.dev.fe
RUN cp "${ENV_FILE}" .env
ENV CI=false
EXPOSE 3000
CMD ["npm", "start"]

# =============================
# Stage 3: Build React app
# =============================
FROM base AS build
ARG ENV_FILE=.env.prod.fe
RUN cp "${ENV_FILE}" .env
RUN npm run build

# =============================
# Stage 4: Serve with Nginx + SSL
# =============================
FROM nginx:stable-alpine AS prod

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy built React app from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create SSL directory (mounted via Docker Compose)
RUN mkdir -p /etc/ssl/private

# Expose ports
EXPOSE 80
EXPOSE 443

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
