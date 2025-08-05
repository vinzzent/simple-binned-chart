# Change Log - EasyBinner

This file documents notable changes for the EasyBinner Power BI visual.

## 1.0.0 - 2025-08-05

### Initial Release

**Data Binning & Aggregation**
* Defines four data roles: "Field to bin," "Value," "Frequency measure," and "Extra Tooltip," each accepting one field.
* Added automatic binning calculation using Sturges' formula.
* Included options for manual binning by a fixed number of bins or by a specific bin size.
* Implemented multiple aggregation methods for bar values and tooltips (Sum, Weighted Average, Minimum, Maximum).

---
**Charting & Visualization**
* Core visual implemented as a histogram-style bar chart with white strokes on bars.
* Added an optional normal distribution curve overlay with rounded line joins for a smoother appearance.
* Implemented dynamic X-axis labels that automatically rotate to prevent overlap.
* Added two types of X-axis labels: bin range (e.g., "10 - 20") and tick values.

---
**Formatting & Customization**
* Added a full formatting pane using the modern formatting model (`formattingSettingsService`).
* Added color customization for chart bars and the normal curve.
* Implemented font controls (family, size, bold, italic) for X and Y-axis labels.
* Added comprehensive data label options, including font styling, color, display units, and decimal precision.
* Added thickness control for the normal curve.
* Implemented support for Power BI's high-contrast themes.

---
**Interactivity & User Experience**
* **Tooltips**: Supports modern "enhanced" and canvas tooltips, in addition to default tooltips.
* **Selection**: Implemented full selection and cross-filtering, including support for highlighting and multi-visual selection across the report.
* **Keyboard Navigation**: Added full support for keyboard focus and navigation. Focused bars are indicated with a dashed black outline for clear visibility.
* **Context Menu**: Enabled context menu support on right-click.
* **Landing Page**: Integrated a landing page with styled headers and help text to guide users on initial setup.
* **Validation**: Implemented clear validation messages for incorrect data role assignments.

---
**Framework & Dependencies**
* **API Version**: Built against Power BI Visuals API version `5.8.0`.
* **Core Charting**: Utilizes `D3.js v7` for all charting and SVG manipulation.
* **Tooling**: Developed with `powerbi-visuals-tools v5.3.0` and `powerbi-visuals-utils v6.x` for formatting, tooltips, and interactivity.
* **Code Quality**: Integrated `ESLint` with the `eslint-plugin-powerbi-visuals` plugin for code linting from the initial release.
* **Open Source**: The project is managed on GitHub, with a homepage and bug tracking available.