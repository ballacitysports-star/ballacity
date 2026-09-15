# ballaCity

Build a modern mobile-first sports community platform called “OpenRun” that allows users to create, discover, and join local pickup sports games.

The platform should feel like a mix of Meetup, OpenTable, and a social sports network.

PRIMARY GOAL:

Help people instantly find and organize pickup sports games nearby while building community, reputation, and social engagement around sports.

TARGET USERS:

- Casual athletes

- Competitive adult players

- College students

- Weekend sports groups

- Young professionals

- Local sports communities

TOP 10 SPORTS SUPPORTED:

1. Basketball

2. Soccer

3. Pickleball

4. Volleyball

5. Tennis

6. Flag Football

7. Baseball

8. Softball

9. Hockey

10. Running / Fitness Groups

PLATFORM REQUIREMENTS:

- Mobile-first responsive design

- Modern clean UI

- Fast interactions

- Social-media quality experience

- Gamified engagement

- Dark mode support

- Real-time updates

- Scalable architecture

CORE FEATURES:

1. USER AUTHENTICATION

- Email/password login

- Google login

- Apple login

- User onboarding flow

- Username selection

- Profile photo upload

- Skill level selection per sport

- Location permissions

2. USER PROFILE SYSTEM

Profiles should include:

- Name

- Username

- Bio

- Favorite sports

- Skill ratings

- Games played

- Attendance reliability score

- Sportsmanship rating

- Highlight videos

- Achievements/badges

- Friends/following

- Recent activity

3. GAME CREATION SYSTEM

Users can create pickup games with:

- Sport type

- Date/time

- Location

- Max players

- Skill level

- Free or paid game

- Public or private game

- Indoor/outdoor toggle

- Game description

- Equipment needed

- Team size

- Recurring game option

4. GAME DISCOVERY

Create:

- Interactive map view

- Nearby games feed

- Filter system

- Sport filters

- Skill level filters

- Time/date filters

- Distance filters

- “Need players now” urgency tag

- Trending games section

- Recommended games using AI

5. REAL-TIME FEATURES

- Live player count

- Real-time chat

- Push notifications

- Last-minute player alerts

- Waitlist system

- Auto-fill open spots

- Live game status updates

6. SOCIAL FEATURES

- Follow users

- Friend system

- Group chats

- Team chats

- Post-game comments

- Like/comment system

- Share games

- Invite friends

- Social activity feed

7. AI HIGHLIGHT VIDEO FEATURE (IMPORTANT)

Users can upload raw gameplay videos.

The platform should use AI to automatically:

- Detect highlights

- Trim dead time

- Create cinematic clips

- Add slow motion

- Add player tracking

- Add transitions

- Add score overlays

- Add background music

- Generate vertical TikTok/Reels versions

- Generate YouTube highlight compilations

- Auto-create thumbnails

- Generate captions/subtitles

- Detect best plays automatically

Include:

- “Create Highlight Reel” button

- AI video editor dashboard

- One-click export to:

  - TikTok

  - Instagram Reels

  - YouTube Shorts

  - YouTube

  - X/Twitter

AI FEATURES:

- AI-generated player performance summaries

- AI matchmaking for balanced teams

- AI game recommendations

- AI skill estimation

- AI toxicity/sportsmanship moderation

8. REPUTATION SYSTEM

Create:

- Attendance reliability score

- No-show tracking

- Skill endorsements

- Sportsmanship ratings

- Verified player badges

- Organizer ratings

9. PAYMENTS

Integrate Stripe for:

- Paid games

- Venue fee splitting

- Tournament entry fees

- Premium subscriptions

10. PREMIUM FEATURES

Create a Pro subscription with:

- Unlimited game hosting

- Advanced analytics

- Priority visibility

- AI advanced highlights

- Custom profile themes

- Enhanced stats

- Verified badge

11. ADMIN PANEL

Include:

- User moderation

- Report system

- Content moderation

- Video moderation

- Analytics dashboard

- Revenue dashboard

- Community management tools

DESIGN STYLE:

- Clean modern sports-tech aesthetic

- Similar quality to:

  - Strava

  - Discord

  - Instagram

  - Nike Training Club

  - Airbnb

- Large sports imagery

- Smooth animations

- Card-based layouts

- Interactive maps

- Dynamic gradients

- High-end typography

PAGES TO BUILD:

- Landing page

- Onboarding flow

- Login/signup

- Home feed

- Map discovery

- Create game page

- Game details page

- User profiles

- Messaging/chat

- Notifications

- Video upload/editor

- AI highlight generator

- Premium subscription page

- Admin dashboard

TECH STACK:

Frontend:

- React Native or Next.js

- Tailwind CSS

- Framer Motion

Backend:

- Supabase or Firebase

- PostgreSQL

Realtime:

- Supabase realtime or WebSockets

Maps:

- Google Maps API

Payments:

- Stripe

AI VIDEO TOOLS:

- OpenAI APIs

- Runway

- FFmpeg

- AWS MediaConvert

- Cloudinary

VIDEO STORAGE:

- AWS S3 or Cloudflare R2

NOTIFICATIONS:

- OneSignal

AI RECOMMENDATION ENGINE:

- Personalized game recommendations

- Skill balancing

- Social graph recommendations

MONETIZATION MODEL:

- Freemium

- Transaction fees

- Premium subscriptions

- Sponsored venues

- Tournament hosting

- Local advertising

IMPORTANT UX GOALS:

- Users can join a game within 15 seconds

- Extremely simple game creation flow

- Highly engaging social feed

- Viral sharing mechanics

- Retention-focused notifications

- Smooth mobile performance

Build the app, also web friendly with scalable architecture and production-ready UI components.

Include polished animations, responsive layouts, and realistic sample data throughout the platform.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9bd576a8-703f-4180-84d6-2cd32f2a851b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Supabase projects

This repo touches two separate Supabase projects — production and a
CLI-linked dev/E2E project (`supabase/config.toml` points at the **dev**
one, not production, on purpose). Mixing them up has already caused a
real incident. See [`CLAUDE.md`](./CLAUDE.md) before running any `supabase`
CLI command or navigating the Supabase dashboard.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
