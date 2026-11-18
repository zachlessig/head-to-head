# Sending Head to Head to the App Store

Status 2026-11-18: the app meets App Review's requirements as far as the code goes, and a signed
App Store build exports cleanly. What's left needs Zach's Apple account.

## Already done (in the code and on the server)

- Pay on the website: inside the iPhone app, Pay opens Stripe's checkout in Safari, and the yard
  unlocks when you come back (`PAY_LINK` in `js/app.js`). US storefront only, Guideline 3.1.1(a).
- Privacy policy at https://headtoheadapp.com/privacy.html, linked from sign-in, footers and Terms
- Privacy manifest `ios/App/App/PrivacyInfo.xcprivacy`, in the app bundle
- `ITSAppUsesNonExemptEncryption` = NO, so no export compliance question on each upload
- iPhone only (no iPad build or iPad screenshots needed); requires arm64
- Delete my account in the app (Guideline 5.1.1(v))
- Camera and location permission messages
- App Review sign-in: `appreview@headtoheadapp.com` with a 16-digit code (see LISTING.md), a demo
  company "Head to Head Demo" with a plan included and no Stripe subscription
- Listing text, keywords, privacy answers and review notes: `appstore/LISTING.md`
- Screenshots: `appstore/screenshots/` (one still needed from a real camera walk)
- Release build: `scripts/release-ios.sh` (export only) or `scripts/release-ios.sh upload`

## Zach's steps, in order

1. **App Store Connect record.** appstoreconnect.apple.com > Apps > + > New App. Platform iOS,
   name from LISTING.md, language English (U.S.), bundle ID com.headtoheadapp.app, SKU
   headtohead-ios-1, full access.
2. **Camera walk screenshot.** During a real camera walk on the iPhone, press the side button and
   volume up. AirDrop it to the Mac; it gets framed to match the others.
3. **Upload the build**: `scripts/release-ios.sh upload` (Claude runs it). It shows up in App
   Store Connect under TestFlight after about 15 minutes of processing.
4. **Fill in the listing** from LISTING.md: text, screenshots, privacy answers, age rating,
   availability United States only, price Free, review notes with the sign-in code.
5. **Submit for review.** Typical review time is a day or two.

## Seller name: Head to Head App LLC (in progress)

The developer account is an individual one (team 8T89UT9858), so the store would show Zach's name
as the seller. Switching it to the LLC:

1. Get a D-U-N-S number for Head to Head App LLC (free): https://developer.apple.com/enroll/duns-lookup/
   Needs the LLC's legal name and address exactly as registered with Utah, a phone number, and
   Zach as the contact. Dun & Bradstreet can take up to about 5 business days.
2. Once it arrives: developer.apple.com > Account > Contact Us > Membership and Account, and ask
   to change the membership from Individual to Organization, giving the D-U-N-S number, legal
   address and a phone number. Zach must be a founder of the LLC. Apple calls to verify.
3. After the switch, check that the app's seller name shows the LLC. Forum reports say it can lag.

The app can be submitted before or after the switch. Submitting first means the first version
shows Zach's name until the switch lands.
