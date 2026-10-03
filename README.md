# BlogFlow — Clay UI + Usability Audit Fixes

A full-stack blog management application with authentication, post CRUD, SQLite persistence, responsive UI, and a tactile Claymorphism visual system.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

Demo account: `demo@blogflow.local` / `demo@12345`

## Accessibility / usability audit fixes applied

1. Consolidated border radii into shared design tokens (six values max).
2. Moved the decorative hero shapes into a dedicated upper-right zone so they do not collide with the headline.
3. Differentiated category pills from hashtag tags: solid category + outlined secondary tags.
4. Removed the repeated red vertical card bar because it did not encode category information.
5. Removed the duplicate toolbar “Sign in to write” action; the persistent header “Sign in” remains the single authentication entry point.
6. Aligned the filter toolbar with the content grid using a 2px horizontal inset to match section-heading margins.
7. The hero-decoration collision fix also resolves the duplicate headline hierarchy issue.
8. Gave the secondary “How it works” button a stronger clay surface and increased CTA spacing.
9. Standardized “Read the latest” to content-width sizing instead of stretching across the stats card.
10. Added breathing room and a divider between post tags and the author/read footer so the footer reads as a clear action/meta row.

The existing routes, authentication, validation, CRUD APIs, SQLite persistence, responsive behavior, reduced-motion support, and theme toggle are preserved.
