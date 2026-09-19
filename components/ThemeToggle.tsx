"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("football-theme");

    const initialTheme: Theme =
      savedTheme === "light" ? "light" : "dark";

    setTheme(initialTheme);

    document.documentElement.classList.toggle(
      "light",
      initialTheme === "light",
    );

    setMounted(true);
  }, []);

  function toggleTheme() {
    const newTheme: Theme =
      theme === "dark" ? "light" : "dark";

    setTheme(newTheme);

    document.documentElement.classList.toggle(
      "light",
      newTheme === "light",
    );

    localStorage.setItem(
      "football-theme",
      newTheme,
    );
  }

  if (!mounted) {
    return (
      <button
        type="button"
        className="theme-toggle"
        aria-label="เปลี่ยนธีม"
      >
        ◐ Theme
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label="เปลี่ยนธีม"
      title={
        theme === "dark"
          ? "เปลี่ยนเป็น Light Mode"
          : "เปลี่ยนเป็น Dark Mode"
      }
    >
      <span>
        {theme === "dark" ? "☀️" : "🌙"}
      </span>

      <span>
        {theme === "dark"
          ? "Light"
          : "Dark"}
      </span>
    </button>
  );
}