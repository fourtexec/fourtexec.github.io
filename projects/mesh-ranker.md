# Mesh Ranker

Mesh Ranker is a native Android app for **МЭШ (Moscow Electronic School)**,
bringing the student diary, lesson schedule, grades, homework, school meals,
account balance, student rankings and profile into one place.

## Get it

Download the signed release APK from [GitHub Releases](https://github.com/fourtexec/mesh-ranker-app/releases/latest).
The app requires **Android 7.0 or newer** (API 24).

## Features

- **Sign in to МЭШ** with a QR code, school credentials or through school.mos.ru, with automatic token capture.
- **Schedule** with daily lessons and date switching.
- **Homework** organised by subject and date, with completion tracking.
- **Grades** with charts and final marks by academic year.
- **Subjects** and statistics.
- **Meals and balance** with account balance, set-lunch menus, preorders and paid or subsidised meal options. Unavailable meal days are skipped when browsing.
- **Student rankings** with a daily cache.
- **Profile and settings** with themes and Russian or English language options.
- **Background session refresh** using WorkManager.

## Built with

Written in **Kotlin** with **Jetpack Compose** and **Material 3**.
The app targets Android API 35 and uses Gradle for builds.

GitHub Actions runs the core JVM tests and builds a signed release APK on
pushes to main, publishing automatically versioned builds to GitHub Releases.

## Build locally

You need **JDK 17** and the **Android SDK (compileSdk 35)**.
From the repository root, run:

```bash
./gradlew assembleDebug
```

Signed release builds require your own signing configuration; see the
[repository README](https://github.com/fourtexec/mesh-ranker-app#readme) for details.

## Source and usage

Source code and issues: [github.com/fourtexec/mesh-ranker-app](https://github.com/fourtexec/mesh-ranker-app).

The upstream README states that the project is distributed for **personal use**.
