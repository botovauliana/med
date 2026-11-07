// Serverless-функция Vercel: отдаёт браузеру адрес проекта Supabase и публичный ключ.
// Ключи берутся из переменных окружения Vercel и в репозиторий не попадают.
// Здесь допустим ТОЛЬКО анонимный (publishable) ключ — он рассчитан на работу
// в браузере и защищён политиками RLS. Service role key сюда класть нельзя.
module.exports = (req, res) => {
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  res.setHeader("Cache-Control", "no-store");
  if (!url || !anonKey) {
    res.status(200).json({ error: "not-configured" });
    return;
  }
  res.status(200).json({ url, anonKey });
};
