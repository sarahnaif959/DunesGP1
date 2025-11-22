// netlify/functions/review.js
const mongoose = require("mongoose");

// اتصال واحد يعاد استخدامه بين الاستدعاءات (عشان الأداء)
let conn = null;

// نفس الـ schema اللي عندك
const reviewSchema = new mongoose.Schema({
  index: Number,
  file1: String,
  file2: String,
  label: String,
  note: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
});

let Review;

async function connect() {
  if (conn) return conn;

  conn = await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // نعرّف الموديل مرّة وحدة
  Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);

  console.log("✅ MongoDB connected (Netlify function)");
  return conn;
}

// handler حق Netlify Function
exports.handler = async (event, context) => {
  try {
    await connect();

    // لو طلب POST → نحفظ / نحدّث
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      console.log("📩 /review POST body:", body);

      const { index, file1, file2, label, note } = body;

      if (index === undefined) {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "Missing index" }),
        };
      }

      const doc = await Review.findOneAndUpdate(
        { index },
        { file1, file2, label, note, updatedAt: new Date() },
        { upsert: true, new: true }
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, data: doc }),
      };
    }

    // لو طلب GET → رجّع كل الريفيوز
    if (event.httpMethod === "GET") {
      const docs = await Review.find().sort({ index: 1 });
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, data: docs }),
      };
    }

    // أي method ثانية م-مسموحة
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, error: "Method Not Allowed" }),
    };
  } catch (err) {
    console.error("❌ Netlify function ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Server error",
        details: err.message,
      }),
    };
  }
};