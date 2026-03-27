export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
        Thread Cartographer
      </h1>
      <p className="text-lg" style={{ color: "var(--text-secondary)" }}>
        Paste a Reddit thread URL to visualize its comment structure.
      </p>
    </main>
  );
}
