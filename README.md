# livekit-animated-avatars
Animated idle and talking avatars for Foundry VTT with LiveKit.

LiveKit Animated Avatars
Display animated portraits in Foundry’s audio/video dock when users have their cameras switched off.
- Choose an idle image or looping video for each user.
- Choose optional talking artwork that appears while that user speaks.
- Use WebM, MP4 or static images.
- Players configure their own artwork; the GM can configure any user.
- Artwork choices are saved in the world and shared with connected users.
- Each browser independently chooses whether to show animated avatars.
- Turning on a real camera restores the camera feed.

Talking detection uses LiveKit’s speaking indicator. It switches between idle and talking artwork; it does not identify individual sounds or generate detailed mouth movements.

Requirements: Foundry VTT 14, the LiveKit AVClient module and a working LiveKit connection. LiveKit’s Use separate window for A/V option must be disabled. Live Actors and a separate audio-analysis agent are unnecessary.

To use it: Enable both modules, open Game Settings → LiveKit Animated Avatars → Configure Avatars, select the artwork and enable Show animated avatars in this browser. Uploading files requires the appropriate Foundry permissions.
