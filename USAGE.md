### **Simple Binned Chart: Usage**

Welcome to the Simple Binned Chart! This guide will walk you through everything you need to know to turn your data into powerful, insightful histograms. This visual is designed to group (or "bin") your numeric data on the fly, allowing you to analyze aggregated values like frquencies, averages, sums across different ranges without ever needing to modify your underlying data model.

Let's dive in!

### **Getting Started: Setting Up Your Chart**

First, you need to provide the right data. The visual has three data fields that you need to fill in the Power BI Fields pane.

* **Field to bin (Required):** This is for the continuous, numeric data you want to group into bins. For example, this could be customer age, product temperature, or a student's score. **This field must contain numeric data.**
* **Value (Required):** This is the numeric measure you want to aggregate and display on the Y-axis. For instance, if you're binning by age, the value could be the *average* number of doctor visits or the *total* sales amount for each age group. **This field must contain a numeric measure.**
* **Extra Tooltip:** You can add an additional measure here. Its aggregated value will appear in the tooltip when you hover over a bar, providing extra context.

Once you drag data into the first two fields, the chart will automatically render. If no data is provided, a landing page will guide you on what to do next.

### **Formatting Your Chart**

You can customize several aspects of your chart's appearance. These options are found in the **Format visual** tab of the Visualizations pane in Power BI.

---

#### **Bins**

This section controls how your data is grouped and how the X-axis (the horizontal axis) is displayed.

* **Bin mode:** Choose how the chart calculates the size and number of bins.

  * **By count:** You specify the exact **Number of bins** you want to see. The chart will divide your data range into this many equal-width bins. (Default)
  * **By size:** You specify a fixed **Bin size** (width) for every bin.
  * **By sample size:** The chart uses the Sturges' formula based on your provided **Sample size** to automatically estimate the optimal number of bins.
* **Bin labels:** Choose how the labels on the X-axis appear.

  * **Tick value:** Shows the start and end values of each bin as ticks on the axis.
  * **Bin range:** Displays the full range (e.g., "0 - 10", "10 - 20") centered under each bar.
* **Font:** Customize the appearance of the X-axis labels, including font family, size, and style (bold/italic).

---

#### **Bars**

This section lets you format the bars and their corresponding data labels.

* **Bar color:** Sets the fill color for all bars in the chart.
* **Y tick font:** Customize the font, size, and style for the labels on the Y-axis (the vertical axis).
* **Show bar value:** A toggle to turn the data labels on or off for each bar. When this is turned **on**, the following options appear:

  * **Color:** Choose the color of the data labels.
  * **Font:** Set the font family, size, and style for the data labels.
  * **Display units:** Control the units for the data labels (e.g., show values in thousands, millions, etc.).
  * **Value decimal places:** Specify the number of decimal places to show for the data labels.

---

#### **Line (Normal Curve)**

This section allows you to overlay a statistical curve on your chart to compare your data's distribution to a normal distribution.

* **Show normal curve:** A toggle to turn the normal distribution curve on or off. When this is turned **on**, the following options appear:

  * **Curve color:** Sets the color of the line.
  * **Curve thickness:** Adjusts the thickness of the line.

### **Interacting with Your Chart**

Your Simple Binned Chart is fully interactive and works just like other Power BI visuals.

* **Cross-Filtering:** Clicking on a bar will select it and filter other visuals on your report page. You can select multiple bars by holding down the **Ctrl** key while clicking. Clicking on the chart's background will clear your selection.

* **Tooltips:** Hover your mouse over any bar to see a detailed tooltip, which shows:

  * The bin range.
  * The bin size.
  * The aggregated value for that bin.
  * The aggregated value of any field you placed in the **Extra Tooltip** data role.

  If you have the **Normal Curve** enabled, hovering over the line will show you the Mean, Standard Deviation, and the Expected Value at that point.

* **Keyboard Navigation:** The visual is fully accessible via the keyboard.

  * Press **Enter** on the visual to focus on the first bar.
  * Use the **Left/Right Arrow** keys to move between bars.
  * Press **Enter** or the **Spacebar** to select a bar.
  * Press **Esc** to clear your selection and return focus to the main visual element.

* **Context Menu:** Right-click on a bar to open the context menu, which allows you to "Include" or "Exclude" data, just like a standard Power BI chart.
