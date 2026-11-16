export function SetupNeeded() {
  return (
    <div className="center-screen">
      <div className="card card--highlight auth-card" style={{ maxWidth: 560 }}>
        <h2>
          Almost ready to <span className="gradient-text">party</span>
        </h2>
        <p className="muted">This app isn't connected to its database yet. To finish setup:</p>
        <ol className="stack" style={{ paddingLeft: '1.2rem', gap: 'var(--space-2)' }}>
          <li>Create a free project at supabase.com.</li>
          <li>Run the SQL in <code>supabase/migrations</code> in the Supabase SQL editor.</li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and paste your project URL and anon key.
          </li>
          <li>Restart the app. The first account you create becomes the admin.</li>
        </ol>
      </div>
    </div>
  )
}
