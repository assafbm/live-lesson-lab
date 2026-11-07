import { useEffect, useState } from "react";

export function DisplayNameInput({ name, onChange }: { name: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return <form className="display-name-form" onSubmit={(event) => { event.preventDefault(); onChange(draft); }}>
    <label>Your name<input autoComplete="nickname" value={draft} maxLength={60}
      onChange={(event) => setDraft(event.target.value)} /></label>
    <button type="submit" className="text-button" disabled={!draft.trim()}>Save name</button>
  </form>;
}
