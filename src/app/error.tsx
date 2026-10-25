"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="form-page wide">
      <p className="eyebrow">FRAME STUDIO</p>
      <h1>Не удалось открыть страницу.</h1>
      <p>
        Попробуйте ещё раз. Если ошибка повторяется, проверьте доступность
        сервиса.
      </p>
      <button className="button" onClick={reset}>
        Попробовать снова
      </button>
    </main>
  );
}
