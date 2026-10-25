import Link from "next/link";
export default function NotFound() {
  return (
    <main className="form-page wide">
      <p className="eyebrow">404 / OUT OF FRAME</p>
      <h1>Этот кадр не найден.</h1>
      <p>Возможно, страница переместилась. Вернёмся к выбору пространства.</p>
      <Link className="button" href="/locations">
        Открыть локации →
      </Link>
    </main>
  );
}
