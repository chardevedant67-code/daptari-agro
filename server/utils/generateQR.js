const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const generateQR = async (product) => {
  const serverIP = process.env.SERVER_IP || 'localhost';
  const port = process.env.PORT || 5000;

  // URL that phone browser will open when scanned
  const qrData = `http://${serverIP}:${port}/p/${product.productId}`;

  const uploadsDir = path.join(__dirname, '../uploads/qr');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const fileName = `${product.productId.replace(/[^a-zA-Z0-9-_]/g, '_')}.png`;
  const filePath = path.join(uploadsDir, fileName);

  await QRCode.toFile(filePath, qrData, {
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#1a227f', light: '#ffffff' },
  });

  const qrCodeUrl = `/uploads/qr/${fileName}`;
  return { qrCodeUrl, qrCodeData: qrData };
};

module.exports = generateQR;
