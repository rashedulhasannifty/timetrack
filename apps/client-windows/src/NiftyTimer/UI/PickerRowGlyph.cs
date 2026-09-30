using System.Globalization;
using System.Windows.Data;
using NiftyTimer.Projects;

namespace NiftyTimer.UI;

/// <summary>› on rows that drill in, nothing elsewhere.</summary>
public sealed class PickerRowTrailingGlyphConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is PickerRowKind.Open ? "›" : string.Empty;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
