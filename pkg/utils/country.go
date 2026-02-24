package utils

import (
	"regexp"
	"strings"
)

// CountryInfo represents country information
type CountryInfo struct {
	Code    string
	Name    string
	Emoji   string
	Aliases []string
}

// Country data
var countries = []CountryInfo{
	{Code: "HK", Name: "Hong Kong", Emoji: "🇭🇰", Aliases: []string{"香港", "Hong Kong", "HK", "HongKong", "HONG KONG"}},
	{Code: "TW", Name: "Taiwan", Emoji: "🇹🇼", Aliases: []string{"台湾", "Taiwan", "TW", "台北", "Taipei"}},
	{Code: "SG", Name: "Singapore", Emoji: "🇸🇬", Aliases: []string{"新加坡", "Singapore", "SG", "狮城"}},
	{Code: "JP", Name: "Japan", Emoji: "🇯🇵", Aliases: []string{"日本", "Japan", "JP", "东京", "Tokyo", "大阪", "Osaka"}},
	{Code: "US", Name: "United States", Emoji: "🇺🇸", Aliases: []string{"美国", "United States", "US", "USA", "America", "洛杉矶", "Los Angeles", "硅谷", "Silicon Valley", "西雅图", "Seattle", "纽约", "New York"}},
	{Code: "KR", Name: "South Korea", Emoji: "🇰🇷", Aliases: []string{"韩国", "South Korea", "Korea", "KR", "首尔", "Seoul"}},
	{Code: "GB", Name: "United Kingdom", Emoji: "🇬🇧", Aliases: []string{"英国", "United Kingdom", "UK", "GB", "Britain", "伦敦", "London"}},
	{Code: "DE", Name: "Germany", Emoji: "🇩🇪", Aliases: []string{"德国", "Germany", "DE", "法兰克福", "Frankfurt"}},
	{Code: "FR", Name: "France", Emoji: "🇫🇷", Aliases: []string{"法国", "France", "FR", "巴黎", "Paris"}},
	{Code: "NL", Name: "Netherlands", Emoji: "🇳🇱", Aliases: []string{"荷兰", "Netherlands", "NL", "阿姆斯特丹", "Amsterdam"}},
	{Code: "AU", Name: "Australia", Emoji: "🇦🇺", Aliases: []string{"澳大利亚", "澳洲", "Australia", "AU", "悉尼", "Sydney"}},
	{Code: "CA", Name: "Canada", Emoji: "🇨🇦", Aliases: []string{"加拿大", "Canada", "CA", "多伦多", "Toronto", "温哥华", "Vancouver"}},
	{Code: "RU", Name: "Russia", Emoji: "🇷🇺", Aliases: []string{"俄罗斯", "Russia", "RU", "莫斯科", "Moscow"}},
	{Code: "IN", Name: "India", Emoji: "🇮🇳", Aliases: []string{"印度", "India", "IN", "孟买", "Mumbai"}},
	{Code: "BR", Name: "Brazil", Emoji: "🇧🇷", Aliases: []string{"巴西", "Brazil", "BR", "圣保罗", "São Paulo"}},
	{Code: "TR", Name: "Turkey", Emoji: "🇹🇷", Aliases: []string{"土耳其", "Turkey", "TR", "伊斯坦布尔", "Istanbul"}},
	{Code: "TH", Name: "Thailand", Emoji: "🇹🇭", Aliases: []string{"泰国", "Thailand", "TH", "曼谷", "Bangkok"}},
	{Code: "VN", Name: "Vietnam", Emoji: "🇻🇳", Aliases: []string{"越南", "Vietnam", "VN", "胡志明", "Ho Chi Minh"}},
	{Code: "PH", Name: "Philippines", Emoji: "🇵🇭", Aliases: []string{"菲律宾", "Philippines", "PH", "马尼拉", "Manila"}},
	{Code: "MY", Name: "Malaysia", Emoji: "🇲🇾", Aliases: []string{"马来西亚", "Malaysia", "MY", "吉隆坡", "Kuala Lumpur"}},
	{Code: "ID", Name: "Indonesia", Emoji: "🇮🇩", Aliases: []string{"印尼", "印度尼西亚", "Indonesia", "ID", "雅加达", "Jakarta"}},
	{Code: "AE", Name: "UAE", Emoji: "🇦🇪", Aliases: []string{"阿联酋", "UAE", "AE", "迪拜", "Dubai"}},
	{Code: "AR", Name: "Argentina", Emoji: "🇦🇷", Aliases: []string{"阿根廷", "Argentina", "AR", "布宜诺斯艾利斯"}},
	{Code: "CL", Name: "Chile", Emoji: "🇨🇱", Aliases: []string{"智利", "Chile", "CL"}},
	{Code: "ZA", Name: "South Africa", Emoji: "🇿🇦", Aliases: []string{"南非", "South Africa", "ZA"}},
	{Code: "IT", Name: "Italy", Emoji: "🇮🇹", Aliases: []string{"意大利", "Italy", "IT", "米兰", "Milan", "罗马", "Rome"}},
	{Code: "ES", Name: "Spain", Emoji: "🇪🇸", Aliases: []string{"西班牙", "Spain", "ES", "马德里", "Madrid"}},
	{Code: "PL", Name: "Poland", Emoji: "🇵🇱", Aliases: []string{"波兰", "Poland", "PL", "华沙", "Warsaw"}},
	{Code: "SE", Name: "Sweden", Emoji: "🇸🇪", Aliases: []string{"瑞典", "Sweden", "SE", "斯德哥尔摩", "Stockholm"}},
	{Code: "NO", Name: "Norway", Emoji: "🇳🇴", Aliases: []string{"挪威", "Norway", "NO", "奥斯陆", "Oslo"}},
	{Code: "FI", Name: "Finland", Emoji: "🇫🇮", Aliases: []string{"芬兰", "Finland", "FI", "赫尔辛基", "Helsinki"}},
	{Code: "CH", Name: "Switzerland", Emoji: "🇨🇭", Aliases: []string{"瑞士", "Switzerland", "CH", "苏黎世", "Zurich"}},
	{Code: "AT", Name: "Austria", Emoji: "🇦🇹", Aliases: []string{"奥地利", "Austria", "AT", "维也纳", "Vienna"}},
	{Code: "BE", Name: "Belgium", Emoji: "🇧🇪", Aliases: []string{"比利时", "Belgium", "BE", "布鲁塞尔", "Brussels"}},
	{Code: "IE", Name: "Ireland", Emoji: "🇮🇪", Aliases: []string{"爱尔兰", "Ireland", "IE", "都柏林", "Dublin"}},
	{Code: "PT", Name: "Portugal", Emoji: "🇵🇹", Aliases: []string{"葡萄牙", "Portugal", "PT", "里斯本", "Lisbon"}},
	{Code: "DK", Name: "Denmark", Emoji: "🇩🇰", Aliases: []string{"丹麦", "Denmark", "DK", "哥本哈根", "Copenhagen"}},
	{Code: "CZ", Name: "Czech", Emoji: "🇨🇿", Aliases: []string{"捷克", "Czech", "CZ", "布拉格", "Prague"}},
	{Code: "RO", Name: "Romania", Emoji: "🇷🇴", Aliases: []string{"罗马尼亚", "Romania", "RO"}},
	{Code: "HU", Name: "Hungary", Emoji: "🇭🇺", Aliases: []string{"匈牙利", "Hungary", "HU", "布达佩斯", "Budapest"}},
	{Code: "GR", Name: "Greece", Emoji: "🇬🇷", Aliases: []string{"希腊", "Greece", "GR", "雅典", "Athens"}},
	{Code: "UA", Name: "Ukraine", Emoji: "🇺🇦", Aliases: []string{"乌克兰", "Ukraine", "UA", "基辅", "Kyiv"}},
	{Code: "IL", Name: "Israel", Emoji: "🇮🇱", Aliases: []string{"以色列", "Israel", "IL", "特拉维夫", "Tel Aviv"}},
	{Code: "EG", Name: "Egypt", Emoji: "🇪🇬", Aliases: []string{"埃及", "Egypt", "EG", "开罗", "Cairo"}},
	{Code: "KZ", Name: "Kazakhstan", Emoji: "🇰🇿", Aliases: []string{"哈萨克斯坦", "Kazakhstan", "KZ"}},
	{Code: "PK", Name: "Pakistan", Emoji: "🇵🇰", Aliases: []string{"巴基斯坦", "Pakistan", "PK"}},
	{Code: "BD", Name: "Bangladesh", Emoji: "🇧🇩", Aliases: []string{"孟加拉", "Bangladesh", "BD"}},
	{Code: "NZ", Name: "New Zealand", Emoji: "🇳🇿", Aliases: []string{"新西兰", "New Zealand", "NZ", "奥克兰", "Auckland"}},
	{Code: "MX", Name: "Mexico", Emoji: "🇲🇽", Aliases: []string{"墨西哥", "Mexico", "MX"}},
	{Code: "CO", Name: "Colombia", Emoji: "🇨🇴", Aliases: []string{"哥伦比亚", "Colombia", "CO"}},
	{Code: "PE", Name: "Peru", Emoji: "🇵🇪", Aliases: []string{"秘鲁", "Peru", "PE"}},
}

// ParseCountryFromNodeName parses country info from a node name
func ParseCountryFromNodeName(nodeName string) *CountryInfo {
	if nodeName == "" {
		return nil
	}

	// Convert to uppercase for matching
	upperName := strings.ToUpper(nodeName)

	for _, country := range countries {
		for _, alias := range country.Aliases {
			// Check if it contains the alias (case-insensitive)
			if strings.Contains(upperName, strings.ToUpper(alias)) {
				return &CountryInfo{
					Code:    country.Code,
					Name:    country.Name,
					Emoji:   country.Emoji,
					Aliases: country.Aliases,
				}
			}
		}
	}

	// Try to match emoji flags
	emojiPattern := regexp.MustCompile(`[\x{1F1E0}-\x{1F1FF}]{2}`)
	if match := emojiPattern.FindString(nodeName); match != "" {
		for _, country := range countries {
			if country.Emoji == match {
				return &CountryInfo{
					Code:    country.Code,
					Name:    country.Name,
					Emoji:   country.Emoji,
					Aliases: country.Aliases,
				}
			}
		}
	}

	return nil
}

// GetAllCountries returns all country information
func GetAllCountries() []CountryInfo {
	return countries
}
