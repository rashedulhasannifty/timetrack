using System.Globalization;
using System.Windows.Data;
using NiftyTimer.Projects;

namespace NiftyTimer.UI;

/// <summary>‹ on the back row, nothing elsewhere. The view adds the arrows; titles never carry them.</summary>
public sealed class PickerRowLeadingGlyphConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is PickerRowKind.Back ? "‹" : string.Empty;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>› on rows that drill in, nothing elsewhere.</summary>
public sealed class PickerRowTrailingGlyphConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is PickerRowKind.Open ? "›" : string.Empty;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
