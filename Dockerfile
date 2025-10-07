FROM node:20-alpine

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Sao chép package.json và package-lock.json (nếu có) để cài đặt dependencies
COPY package*.json ./

# Cài đặt dependencies
RUN npm install

# Sao chép mã nguồn vào thư mục làm việc
COPY . .

# Lệnh chạy ứng dụng
CMD ["node", "src/index.js"]
