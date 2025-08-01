import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import powerbi from "powerbi-visuals-api";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;
import Slice = formattingSettings.Slice;
import ColorPicker = formattingSettings.ColorPicker;
import NumUpDown = formattingSettings.NumUpDown;
import AutoDropdown = formattingSettings.AutoDropdown;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import FontControl = formattingSettings.FontControl;

// BINS card
class BinsSettingsCard extends Card {
    name = "bins";
    displayName = "Bins";
    // START: New bin label font settings
    binMode = new AutoDropdown({
        name: "binMode",
        displayName: "Bin mode",
        value: "byCount"
    });

    sampleSize = new NumUpDown({
        name: "sampleSize",
        displayName: "Sample size",
        value: 1000,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 }
        }
    });

    numberOfBins = new NumUpDown({
        name: "numberOfBins",
        displayName: "Number of bins",
        value: 10,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 }
        }
    });

    binSize = new NumUpDown({
        name: "binSize",
        displayName: "Bin size",
        value: 50,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 }
        }
    });

    xAxisLabelsType = new AutoDropdown({
        name: "xAxisLabelsType",
        displayName: "Tick value",
        value: "tickValue"
    });
    binLabelFont = new FontControl({
        name: "binLabelFont",
        displayName: "Font",
        fontFamily: new formattingSettings.FontPicker({
            name: "binLabelFontFamily",
            displayName: "Font Family",
            value: "sans-serif"
        }),
        fontSize: new formattingSettings.NumUpDown({
            name: "binLabelFontSize",
            displayName: "Font Size",
            value: 11,
            options: {
                minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
                maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 }
            }
        }),
        bold: new formattingSettings.ToggleSwitch({
            name: "binLabelFontBold",
            displayName: "Bold",
            value: false
        }),
        italic: new formattingSettings.ToggleSwitch({
            name: "binLabelFontItalic",
            displayName: "Italic",
            value: false
        })
    });
    // END: New bin label font settings
    slices: Slice[] = [this.binMode, this.sampleSize, this.numberOfBins, this.binSize, this.xAxisLabelsType, this.binLabelFont];

    public updateSlices() {
        this.sampleSize.visible = this.binMode.value === "automatic";
        this.numberOfBins.visible = this.binMode.value === "byCount";
        this.binSize.visible = this.binMode.value === "bySize";
    }
}

// BARS card
class BarsSettingsCard extends Card {
    name = "bars";
    displayName = "Bars";

    fill = new ColorPicker({
        name: "fill",
        displayName: "Bar color",
        value: { value: "#01B8AA" }
    });
    yTickFont = new FontControl({
        name: "yTickFont",
        displayName: "Y tick font",
        fontFamily: new formattingSettings.FontPicker({
            name: "yTickFontFamily",
            displayName: "Font Family",
            value: "sans-serif"
        }),
        fontSize: new formattingSettings.NumUpDown({
            name: "yTickFontSize",
            displayName: "Font Size",
            value: 11,
            options: {
                minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
                maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 }
            }
        }),
        bold: new formattingSettings.ToggleSwitch({
            name: "yTickFontBold",
            displayName: "Bold",
            value: false
        }),
        italic: new formattingSettings.ToggleSwitch({
            name: "yTickFontItalic",
            displayName: "Italic",
            value: false
        })
    });
    showBarValues = new ToggleSwitch({
        name: "showBarValues",
        displayName: "Show bar value",
        value: false
    });

    // slices: Slice[] = [this.fill, this.showBarValues];
    labelFontColor = new ColorPicker({
        name: "labelFontColor",
        displayName: "Color",
        value: { value: "#605E5C" }
    });

    labelFont = new FontControl({
        name: "labelFont",
        displayName: "Font",
        fontFamily: new formattingSettings.FontPicker({
            name: "labelFontFamily",
            displayName: "Font Family",
            value: "Arial"
        }),
        fontSize: new formattingSettings.NumUpDown({
            name: "labelFontSize",
            displayName: "Font Size",
            value: 12,
            options: {
                minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
                maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 }
            }
        }),
        bold: new formattingSettings.ToggleSwitch({
            name: "labelFontBold",
            displayName: "Bold",
            value: false
        }),
        italic: new formattingSettings.ToggleSwitch({
            name: "labelFontItalic",
            displayName: "Italic",
            value: false
        })
    });

    labelDisplayUnits = new AutoDropdown({
        name: "labelDisplayUnits",
        displayName: "Display units",
        value: "0" // "0" for Auto
    });

    labelPrecision = new NumUpDown({
        name: "labelPrecision",
        displayName: "Value decimal places",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    slices: Slice[] = [
        this.fill,
        this.yTickFont, // Added here
        this.showBarValues,
        this.labelFontColor,
        this.labelFont,
        this.labelDisplayUnits,
        this.labelPrecision
    ];

    // --- ADDED: Method to conditionally show/hide label options ---
    public updateSlices() {
        const showLabels = this.showBarValues.value;
        this.labelFontColor.visible = showLabels;
        this.labelFont.visible = showLabels;
        this.labelDisplayUnits.visible = showLabels;
        this.labelPrecision.visible = showLabels;
    }
}

// LINE card
class LineSettingsCard extends Card {
    name = "line";
    displayName = "Line";

    showNormalCurve = new ToggleSwitch({
        name: "showNormalCurve",
        displayName: "Show normal curve",
        value: false
    });

    curveColor = new ColorPicker({
        name: "curveColor",
        displayName: "Curve color",
        value: { value: "#E66C37" }
    });

    // Added a numeric up-down control for line thickness.
    strokeWidth = new NumUpDown({
        name: "strokeWidth",
        displayName: "Curve thickness",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });


    slices: Slice[] = [this.showNormalCurve, this.curveColor, this.strokeWidth];

    public updateSlices() {
        const showCurve = this.showNormalCurve.value;
        this.curveColor.visible = showCurve;
        this.strokeWidth.visible = showCurve;
    }
}

export class BinnedChartSettingsModel extends Model {
    bins = new BinsSettingsCard();
    bars = new BarsSettingsCard();
    line = new LineSettingsCard();

    cards: Card[] = [this.bins, this.bars, this.line];

    public updateAllSlices() {
        this.bins.updateSlices();
        this.bars.updateSlices();
        this.line.updateSlices();
    }
}